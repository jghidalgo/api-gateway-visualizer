// API Gateway Simulator
class APIGatewaySimulator {
    constructor() {
        this.stats = {
            totalRequests: 0,
            successRequests: 0,
            throttledRequests: 0,
            cacheHits: 0
        };
        
        this.requestHistory = [];
        this.cache = new Map();
        this.throttleTracker = {
            requests: [],
            limit: 10, // requests per second
            window: 1000 // 1 second window
        };
        
        this.currentIntegration = 'lambda';
        this.initializeEventListeners();
        this.updateDisplay();
    }

    initializeEventListeners() {
        // Integration type selection
        document.querySelectorAll('.integration-card').forEach(card => {
            card.addEventListener('click', (e) => {
                this.selectIntegration(e.currentTarget.dataset.type);
            });
        });

        // Code tab buttons
        document.querySelectorAll('.code-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                this.switchCodeTab(e.target.dataset.tab);
            });
        });
    }

    selectIntegration(type) {
        this.currentIntegration = type;
        
        // Update active integration card
        document.querySelectorAll('.integration-card').forEach(card => {
            card.classList.remove('active');
        });
        document.querySelector(`[data-type="${type}"]`).classList.add('active');

        // Update backend display
        const backendNames = {
            lambda: 'Lambda Function',
            http: 'HTTP Endpoint',
            'aws-service': 'AWS Service',
            mock: 'Mock Integration'
        };
        
        document.getElementById('backend-type').textContent = backendNames[type];
        this.logRequest(`Switched to ${backendNames[type]} integration`, 'info');
    }

    async sendRequest() {
        const method = document.getElementById('http-method').value;
        const path = document.getElementById('api-path').value;
        const authToken = document.getElementById('auth-token').value;
        const source = document.getElementById('request-source').value;

        const request = {
            id: Date.now(),
            method,
            path,
            authToken,
            source,
            timestamp: new Date(),
            status: 'processing'
        };

        this.stats.totalRequests++;
        this.requestHistory.push(request);

        this.logRequest(`${method} ${path} from ${source}`, 'info');
        this.resetFlowStates();
        
        // Start request flow
        await this.processRequestFlow(request);
    }

    async processRequestFlow(request) {
        try {
            // Step 1: Client sends request
            this.updateFlowStep('client', 'active', 'Sending Request');
            await this.delay(500);

            // Step 2: API Gateway receives request
            this.updateFlowStep('client', 'success', 'Request Sent');
            this.updateFlowStep('gateway', 'processing', 'Processing');
            await this.delay(300);

            // Step 3: Authentication
            const authResult = await this.checkAuthentication(request);
            if (!authResult.success) {
                await this.handleRequestFailure(request, 401, 'Authentication Failed');
                return;
            }

            // Step 4: Throttling
            const throttleResult = await this.checkThrottling(request);
            if (!throttleResult.success) {
                await this.handleRequestFailure(request, 429, 'Rate Limited');
                return;
            }

            // Step 5: Caching
            const cacheResult = await this.checkCache(request);
            if (cacheResult.hit) {
                await this.handleCacheHit(request, cacheResult.response);
                return;
            }

            // Step 6: Backend integration
            this.updateFlowStep('gateway', 'success', 'Validated');
            this.updateFlowStep('backend', 'processing', 'Executing');
            await this.delay(this.getBackendLatency());

            const backendResponse = await this.callBackend(request);
            
            // Step 7: Response processing
            this.updateFlowStep('backend', 'success', 'Completed');
            this.updateFlowStep('response', 'processing', 'Preparing Response');
            await this.delay(200);

            // Cache the response if caching is enabled
            if (document.getElementById('enable-caching').checked) {
                this.cacheResponse(request, backendResponse);
            }

            await this.handleSuccessResponse(request, backendResponse);

        } catch (error) {
            await this.handleRequestFailure(request, 500, 'Internal Server Error');
        }
    }

    async checkAuthentication(request) {
        const authEnabled = document.getElementById('enable-auth').checked;
        
        if (!authEnabled) {
            document.getElementById('auth-result').textContent = 'Disabled';
            document.getElementById('auth-result').className = 'detail-value';
            return { success: true };
        }

        await this.delay(100);

        if (!request.authToken) {
            document.getElementById('auth-result').textContent = 'Failed';
            document.getElementById('auth-result').className = 'detail-value error';
            this.logRequest('Authentication failed: No token provided', 'error');
            return { success: false };
        }

        // Simulate token validation
        const isValidToken = request.authToken.length > 10; // Simple validation
        
        if (isValidToken) {
            document.getElementById('auth-result').textContent = 'Passed';
            document.getElementById('auth-result').className = 'detail-value success';
            this.logRequest('Authentication successful', 'success');
            return { success: true };
        } else {
            document.getElementById('auth-result').textContent = 'Failed';
            document.getElementById('auth-result').className = 'detail-value error';
            this.logRequest('Authentication failed: Invalid token', 'error');
            return { success: false };
        }
    }

    async checkThrottling(request) {
        const throttlingEnabled = document.getElementById('enable-throttling').checked;
        
        if (!throttlingEnabled) {
            document.getElementById('throttle-result').textContent = 'Disabled';
            document.getElementById('throttle-result').className = 'detail-value';
            return { success: true };
        }

        await this.delay(50);

        // Clean old requests from tracking window
        const now = Date.now();
        this.throttleTracker.requests = this.throttleTracker.requests.filter(
            timestamp => now - timestamp < this.throttleTracker.window
        );

        // Check if we're over the limit
        if (this.throttleTracker.requests.length >= this.throttleTracker.limit) {
            document.getElementById('throttle-result').textContent = 'Blocked';
            document.getElementById('throttle-result').className = 'detail-value error';
            this.logRequest('Request throttled: Rate limit exceeded', 'warning');
            this.stats.throttledRequests++;
            return { success: false };
        }

        // Add current request to tracker
        this.throttleTracker.requests.push(now);
        document.getElementById('throttle-result').textContent = 'Passed';
        document.getElementById('throttle-result').className = 'detail-value success';
        this.logRequest('Throttling check passed', 'success');
        return { success: true };
    }

    async checkCache(request) {
        const cachingEnabled = document.getElementById('enable-caching').checked;
        
        if (!cachingEnabled) {
            document.getElementById('cache-result').textContent = 'Disabled';
            document.getElementById('cache-result').className = 'detail-value';
            return { hit: false };
        }

        await this.delay(50);

        const cacheKey = `${request.method}:${request.path}`;
        const cachedResponse = this.cache.get(cacheKey);

        if (cachedResponse && Date.now() - cachedResponse.timestamp < 300000) { // 5 min TTL
            document.getElementById('cache-result').textContent = 'Hit';
            document.getElementById('cache-result').className = 'detail-value success';
            this.logRequest('Cache hit: Returning cached response', 'success');
            this.stats.cacheHits++;
            return { hit: true, response: cachedResponse.data };
        }

        document.getElementById('cache-result').textContent = 'Miss';
        document.getElementById('cache-result').className = 'detail-value warning';
        this.logRequest('Cache miss: Proceeding to backend', 'info');
        return { hit: false };
    }

    async callBackend(request) {
        const integrationLatencies = {
            lambda: { min: 50, max: 200 },
            http: { min: 100, max: 1000 },
            'aws-service': { min: 20, max: 100 },
            mock: { min: 5, max: 20 }
        };

        const latency = integrationLatencies[this.currentIntegration];
        const actualLatency = Math.random() * (latency.max - latency.min) + latency.min;
        
        await this.delay(actualLatency);

        // Simulate occasional backend errors
        const errorRate = this.currentIntegration === 'http' ? 0.1 : 0.05;
        if (Math.random() < errorRate) {
            throw new Error('Backend error');
        }

        const responses = {
            lambda: { statusCode: 200, body: { message: 'Lambda function executed successfully', data: { userId: 123, name: 'John Doe' } } },
            http: { statusCode: 200, body: { message: 'HTTP endpoint response', data: { result: 'success' } } },
            'aws-service': { statusCode: 200, body: { message: 'AWS service operation completed', data: { operation: 'success' } } },
            mock: { statusCode: 200, body: { message: 'Mock response', data: { mock: true } } }
        };

        this.logRequest(`Backend ${this.currentIntegration} responded in ${Math.round(actualLatency)}ms`, 'success');
        return responses[this.currentIntegration];
    }

    cacheResponse(request, response) {
        const cacheKey = `${request.method}:${request.path}`;
        this.cache.set(cacheKey, {
            data: response,
            timestamp: Date.now()
        });
        this.logRequest('Response cached for future requests', 'info');
    }

    async handleCacheHit(request, response) {
        this.updateFlowStep('gateway', 'success', 'Cache Hit');
        this.updateFlowStep('backend', '', 'Skipped');
        this.updateFlowStep('response', 'success', 'Cached Response');
        
        document.getElementById('response-code').textContent = '200 OK (Cached)';
        document.getElementById('response-code').className = 'response-code success';
        
        this.stats.successRequests++;
        this.logRequest('Request completed with cached response (~5ms)', 'success');
        this.updateDisplay();
    }

    async handleSuccessResponse(request, response) {
        this.updateFlowStep('response', 'success', 'Response Sent');
        
        document.getElementById('response-code').textContent = `${response.statusCode} OK`;
        document.getElementById('response-code').className = 'response-code success';
        
        this.stats.successRequests++;
        this.logRequest(`Request completed successfully: ${response.statusCode}`, 'success');
        this.updateDisplay();
    }

    async handleRequestFailure(request, statusCode, reason) {
        this.updateFlowStep('gateway', 'error', 'Failed');
        this.updateFlowStep('backend', '', 'Skipped');
        this.updateFlowStep('response', 'error', reason);
        
        document.getElementById('response-code').textContent = `${statusCode} ${reason}`;
        document.getElementById('response-code').className = 'response-code error';
        
        this.logRequest(`Request failed: ${statusCode} ${reason}`, 'error');
        this.updateDisplay();
    }

    updateFlowStep(stepType, state, status) {
        const step = document.querySelector(`.${stepType}-step`);
        const statusElement = document.getElementById(`${stepType}-status`);
        
        // Remove all state classes
        step.classList.remove('active', 'processing', 'success', 'error');
        
        // Add new state class
        if (state) {
            step.classList.add(state);
        }
        
        // Update status text
        if (statusElement && status) {
            statusElement.textContent = status;
        }
    }

    resetFlowStates() {
        const steps = document.querySelectorAll('.flow-step');
        steps.forEach(step => {
            step.classList.remove('active', 'processing', 'success', 'error');
        });

        // Reset status texts
        document.getElementById('client-status').textContent = 'Ready';
        document.getElementById('gateway-status').textContent = 'Waiting';
        document.getElementById('backend-status').textContent = 'Idle';
        document.getElementById('response-status').textContent = '-';
        document.getElementById('response-code').textContent = '-';
        
        // Reset detail values
        document.getElementById('auth-result').textContent = '-';
        document.getElementById('auth-result').className = 'detail-value';
        document.getElementById('throttle-result').textContent = '-';
        document.getElementById('throttle-result').className = 'detail-value';
        document.getElementById('cache-result').textContent = '-';
        document.getElementById('cache-result').className = 'detail-value';
    }

    getBackendLatency() {
        const latencies = {
            lambda: 150,
            http: 500,
            'aws-service': 75,
            mock: 10
        };
        return latencies[this.currentIntegration] || 100;
    }

    updateDisplay() {
        document.getElementById('total-requests').textContent = this.stats.totalRequests;
        document.getElementById('success-requests').textContent = this.stats.successRequests;
        document.getElementById('throttled-requests').textContent = this.stats.throttledRequests;
        document.getElementById('cache-hits').textContent = this.stats.cacheHits;
    }

    switchCodeTab(tabName) {
        // Update active tab
        document.querySelectorAll('.code-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // Show corresponding code
        document.querySelectorAll('.code-content pre').forEach(pre => {
            pre.style.display = 'none';
        });
        document.getElementById(`${tabName}-code`).style.display = 'block';
    }

    logRequest(message, type = 'info') {
        const logContent = document.getElementById('log-content');
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;
        logEntry.textContent = `[${timestamp}] ${message}`;
        
        logContent.appendChild(logEntry);
        logContent.scrollTop = logContent.scrollHeight;

        // Keep only last 100 entries
        while (logContent.children.length > 100) {
            logContent.removeChild(logContent.firstChild);
        }

        // Also log to console
        console.log(`[API Gateway] ${message}`);
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    clearLog() {
        const logContent = document.getElementById('log-content');
        logContent.innerHTML = '<div class="log-entry">Log cleared. Ready for new requests...</div>';
    }
}

// Global functions for HTML onclick handlers
let apiGatewaySimulator;

function sendRequest() {
    apiGatewaySimulator.sendRequest();
}

function clearLog() {
    apiGatewaySimulator.clearLog();
}

// Initialize simulator when page loads
document.addEventListener('DOMContentLoaded', () => {
    apiGatewaySimulator = new APIGatewaySimulator();
    
    console.log('=== AWS API Gateway Simulator ===');
    console.log('Features: Authentication, Throttling, Caching, Multiple Integrations');
    console.log('Integration Types: Lambda, HTTP, AWS Services, Mock');
    console.log('Try different configurations and request patterns!');
    console.log('=== Send requests to see the complete flow! ===');
});