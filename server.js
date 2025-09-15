const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse');
const { stringify } = require('csv-stringify');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = './uploads';
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir);
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  }
});

// Serve static files
app.use(express.static('public'));
app.use(express.json());

// Store active checking processes and domain column index
const activeChecks = new Map();
const fileDomainColumnIndex = new Map(); // Map filename → domain column index

// Main route - serve the HTML interface
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Domain CSV Checker</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/core@1.0.0-beta17/dist/css/tabler.min.css">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons@2.40.0/dist/iconfont/tabler-icons.min.css">
    <script src="https://cdn.jsdelivr.net/npm/@tabler/core@1.0.0-beta17/dist/js/tabler.min.js"></script>
    <style>
        .upload-section {
            border: 2px dashed var(--tblr-border-color);
            border-radius: 0.5rem;
            padding: 2rem;
            text-align: center;
            margin-bottom: 1.5rem;
            transition: all 0.2s ease;
            cursor: pointer;
            background: var(--tblr-bg-surface);
            min-height: 120px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
        }

        .upload-section:hover {
            border-color: var(--tblr-primary);
            background: var(--tblr-bg-surface-hover);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }

        .upload-section.dragover {
            border-color: var(--tblr-primary);
            background: var(--tblr-bg-primary-subtle);
            transform: scale(1.02);
        }

        #fileInput {
            display: none;
        }

        .domain-list {
            max-height: 400px;
            overflow-y: auto;
        }

        .domain-item {
            padding: 0.75rem 0;
            border-bottom: 1px solid var(--tblr-border-color);
        }

        .domain-item:last-child {
            border-bottom: none;
        }

        .loading-spinner {
            display: inline-block;
            width: 1rem;
            height: 1rem;
            border: 2px solid var(--tblr-border-color);
            border-radius: 50%;
            border-top-color: var(--tblr-primary);
            animation: spin 1s ease-in-out infinite;
            margin-right: 0.5rem;
        }

        .empty-state {
            text-align: center;
            padding: 3rem 1rem;
        }

        .empty-state-icon {
            margin-bottom: 1rem;
        }

        .empty-state-title {
            font-size: 1.25rem;
            font-weight: 600;
            margin-bottom: 0.5rem;
        }

        .empty-state-subtitle {
            color: var(--tblr-secondary);
            margin-bottom: 0;
        }

        .nav-link.active {
            background-color: var(--tblr-primary);
            color: white !important;
            border-radius: 0.375rem;
        }

        .nav-link.active:hover {
            background-color: var(--tblr-primary);
            color: white !important;
        }

        .navbar-nav .nav-link {
            padding: 0.5rem 1rem;
            margin: 0 0.25rem;
            border-radius: 0.375rem;
            transition: all 0.2s ease;
        }

        .navbar-nav .nav-link:hover {
            background-color: var(--tblr-bg-surface-hover);
        }

        .navbar-brand {
            font-size: 1.25rem;
            font-weight: 600;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <!-- Navigation Bar -->
    <header class="navbar navbar-expand-md navbar-light d-print-none border-bottom">
        <div class="container-xl">
            <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbar-menu" aria-controls="navbar-menu" aria-expanded="false" aria-label="Toggle navigation">
                <span class="navbar-toggler-icon"></span>
            </button>
            <h1 class="navbar-brand navbar-brand-autodark d-none-navbar-horizontal pe-0 pe-md-3">
                <i class="ti ti-world me-2"></i>
                Umbraco CMS Detector
            </h1>
            <div class="navbar-nav flex-row order-md-last">
                <div class="nav-item dropdown">
                    <button type="button" class="btn btn-outline-secondary btn-sm" onclick="toggleTheme()">
                        <i class="ti ti-sun" id="themeIcon"></i>
                    </button>
                </div>
            </div>
            <div class="collapse navbar-collapse" id="navbar-menu">
                <div class="d-flex flex-column flex-md-row flex-fill align-items-stretch align-items-md-center">
                    <ul class="navbar-nav">
                        <li class="nav-item">
                            <a class="nav-link" href="#" onclick="showHomePage()">
                                <i class="ti ti-home me-2"></i>
                                Home
                            </a>
                        </li>
                        <li class="nav-item">
                            <a class="nav-link" href="#" onclick="showDomainsPage()">
                                <i class="ti ti-list me-2"></i>
                                View Domains
                            </a>
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    </header>

    <div class="page-wrapper">
        <!-- Home Page -->
        <div class="container-xl" id="homePage">
            <div class="row justify-content-center">
                <div class="col-lg-10 col-xl-9">
                    <div class="card">
                        <div class="card-header">
                            <h3 class="card-title">
                                <i class="ti ti-upload me-2"></i>
                                Upload CSV File
                            </h3>
                            <div class="card-subtitle">Advanced Umbraco detection with evidence analysis</div>
                        </div>
                        <div class="card-body">
                            <div class="upload-section" id="uploadSection">
                                <div class="text-muted mb-3">
                                    <i class="ti ti-upload me-2"></i>
                                    Drag & drop your CSV file here or click to browse
                                </div>
                                <small class="text-muted d-block mb-3">Note: Domains will be read from the 3rd column</small>
                                <button class="btn btn-primary" onclick="document.getElementById('fileInput').click()">
                                    <i class="ti ti-file me-2"></i>
                                    Choose CSV File
                                </button>
                                <input type="file" id="fileInput" accept=".csv" />
                            </div>

                            <div id="fileInfo" class="alert alert-info" style="display: none;"></div>
                            <div id="alerts"></div>

                            <div class="row g-3 align-items-center justify-content-center my-4">
                                <div class="col-auto">
                                    <label for="checkMethod" class="form-label mb-0">Detection Method:</label>
                                </div>
                                <div class="col-auto">
                                    <select id="checkMethod" class="form-select">
                                        <option value="http">🚀 Lightweight HTTP (Recommended)</option>
                                    </select>
                                </div>
                                <div class="col-auto">
                                    <button id="checkBtn" class="btn btn-success" style="display: none;" onclick="startChecking()">
                                        <i class="ti ti-play me-2"></i>
                                        Start Checking Domains
                                    </button>
                                    <button id="stopBtn" class="btn btn-danger" style="display: none;" onclick="stopChecking()">
                                        <i class="ti ti-square me-2"></i>
                                        Stop Checking
                                    </button>
                                </div>
                            </div>

                            <div class="progress-container" id="progressContainer" style="display: none;">
                                <div class="progress mb-3">
                                    <div class="progress-bar" id="progressFill" role="progressbar" style="width: 0%"></div>
                                </div>
                                <div class="text-center mb-3">
                                    <div class="status" id="status"></div>
                                    <div class="text-muted small">Progress: <span id="progressText">0%</span></div>
                                </div>
                                <div class="row g-3">
                                    <div class="col-md-4">
                                        <div class="card card-sm">
                                            <div class="card-body text-center">
                                                <div class="text-h3 mb-1" id="totalCount">0</div>
                                                <div class="text-muted">Total</div>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-md-4">
                                        <div class="card card-sm">
                                            <div class="card-body text-center">
                                                <div class="text-h3 mb-1" id="checkedCount">0</div>
                                                <div class="text-muted">Checked</div>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-md-4">
                                        <div class="card card-sm">
                                            <div class="card-body text-center">
                                                <div class="text-h3 mb-1" id="successCount">0</div>
                                                <div class="text-muted">Success (200)</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="results" id="results" style="display: none;">
                                <div class="card">
                                    <div class="card-header">
                                        <h3 class="card-title">
                                            <i class="ti ti-check me-2"></i>
                                            Umbraco CMS Detected
                                        </h3>
                                    </div>
                                    <div class="card-body">
                                        <div class="domain-list" id="successList">
                                            <div class="empty-state" id="emptyState" style="display: none;">
                                                <div class="empty-state-icon">
                                                    <i class="ti ti-search text-muted" style="font-size: 3rem;"></i>
                                                </div>
                                                <p class="empty-state-title">No domains found yet</p>
                                                <p class="empty-state-subtitle">Upload a CSV file and start checking to see results here.</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="card-footer">
                                        <div class="d-flex gap-2 justify-content-center">
                                            <button class="btn btn-secondary" id="downloadBtn" onclick="downloadResults()">
                                                <i class="ti ti-download me-2"></i>
                                                Download Umbraco Results CSV
                                            </button>
                                            <button class="btn btn-info" id="emailExtractBtn" onclick="proceedToEmailExtraction()" style="display: none;">
                                                <i class="ti ti-mail me-2"></i>
                                                Proceed with Email Extraction
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Domains Page -->
        <div class="container-xl" id="domainsPage" style="display: none;">
            <div class="row">
                <div class="col-12">
                    <div class="card">
                        <div class="card-header">
                            <div class="d-flex justify-content-between align-items-center">
                                <div>
                                    <h3 class="card-title">
                                        <i class="ti ti-list me-2"></i>
                                        Domain Results
                                    </h3>
                                    <div class="card-subtitle">View and manage detected Umbraco domains with company information</div>
                                </div>
                                <div class="btn-group">
                                    <button type="button" class="btn btn-outline-secondary btn-sm" onclick="refreshDomainsData()">
                                        <i class="ti ti-refresh me-2"></i>
                                        Refresh
                                    </button>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Progress indicator for domains page -->
                        <div class="card-body border-bottom" id="domainsProgressIndicator" style="display: none;">
                            <div class="d-flex align-items-center justify-content-between">
                                <div class="d-flex align-items-center">
                                    <div class="loading-spinner me-3"></div>
                                    <div>
                                        <div class="fw-bold" id="domainsProgressText">Processing domains...</div>
                                        <div class="text-muted small" id="domainsProgressDetails">Checking for Umbraco CMS</div>
                                    </div>
                                </div>
                                <div class="text-end">
                                    <div class="fw-bold text-primary" id="domainsProgressCount">0/0</div>
                                    <div class="text-muted small">Domains checked</div>
                                </div>
                            </div>
                        </div>
                        <div class="card-body">
                            <div id="domainsTableContainer">
                                <div class="empty-state" id="domainsEmptyState">
                                    <div class="empty-state-icon">
                                        <i class="ti ti-search text-muted" style="font-size: 3rem;"></i>
                                    </div>
                                    <p class="empty-state-title">No domains found yet</p>
                                    <p class="empty-state-subtitle">Upload a CSV file and start checking to see results here.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Footer -->
        <footer class="footer footer-transparent d-print-none">
            <div class="container-xl">
                <div class="row text-center align-items-center flex-row-reverse">
                    <div class="col-12 col-lg-auto mt-3 mt-lg-0">
                        <ul class="list-inline list-inline-dots mb-0">
                            <li class="list-inline-item">
                                Built with <i class="ti ti-heart text-danger"></i> using Tabler.io
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </footer>
    </div>

    <script>
        let uploadedFileName = '';
        let checkJobId = '';

        // Theme management
        function toggleTheme() {
            const html = document.documentElement;
            const themeIcon = document.getElementById('themeIcon');
            
            if (html.getAttribute('data-bs-theme') === 'dark') {
                html.setAttribute('data-bs-theme', 'light');
                themeIcon.className = 'ti ti-sun';
                localStorage.setItem('theme', 'light');
            } else {
                html.setAttribute('data-bs-theme', 'dark');
                themeIcon.className = 'ti ti-moon';
                localStorage.setItem('theme', 'dark');
            }
        }

        // Initialize theme from localStorage
        function initTheme() {
            const savedTheme = localStorage.getItem('theme') || 'light';
            const html = document.documentElement;
            const themeIcon = document.getElementById('themeIcon');
            
            html.setAttribute('data-bs-theme', savedTheme);
            themeIcon.className = savedTheme === 'dark' ? 'ti ti-moon' : 'ti ti-sun';
        }

        // Initialize theme when page loads
        initTheme();
        
        // Set initial page
        showHomePage();

        // Global storage for domains data
        let domainsData = [];
        let currentJobId = '';
        
        // Update progress on domains page
        function updateDomainsPageProgress(progress) {
            const progressIndicator = document.getElementById('domainsProgressIndicator');
            const progressText = document.getElementById('domainsProgressText');
            const progressDetails = document.getElementById('domainsProgressDetails');
            const progressCount = document.getElementById('domainsProgressCount');
            
            if (!progressIndicator || !progressText || !progressDetails || !progressCount) {
                return; // Elements don't exist, skip update
            }
            
            // Show progress indicator
            progressIndicator.style.display = 'block';
            
            // Update progress text
            if (progress.currentDomain) {
                progressText.textContent = 'Checking: ' + progress.currentDomain;
                progressDetails.textContent = 'Processing domain for Umbraco CMS';
            } else {
                if (progress.status === 'completed') {
                    progressText.textContent = 'Domain checking completed!';
                    progressDetails.textContent = progress.successCount + ' domains found with Umbraco CMS';
                } else if (progress.status === 'stopped') {
                    progressText.textContent = 'Domain checking stopped';
                    progressDetails.textContent = 'Process was stopped by user';
                } else {
                    progressText.textContent = 'Processing domains...';
                    progressDetails.textContent = 'Checking for Umbraco CMS';
                }
            }
            
            // Update progress count
            progressCount.textContent = progress.checked + '/' + progress.total;
            
            // Hide progress indicator when completed
            if (progress.status === 'completed' || progress.status === 'stopped') {
                setTimeout(() => {
                    if (progressIndicator) {
                        progressIndicator.style.display = 'none';
                    }
                }, 3000); // Hide after 3 seconds
            }
        }

        // Global notification function
        function showGlobalNotification(message, type = 'info') {
            // Create notification element if it doesn't exist
            let notificationContainer = document.getElementById('globalNotificationContainer');
            if (!notificationContainer) {
                notificationContainer = document.createElement('div');
                notificationContainer.id = 'globalNotificationContainer';
                notificationContainer.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 9999; max-width: 400px;';
                document.body.appendChild(notificationContainer);
            }
            
            const notification = document.createElement('div');
            notification.className = 'alert alert-' + type + ' alert-dismissible';
            notification.innerHTML = message + '<a href="#" class="btn-close" data-bs-dismiss="alert" aria-label="close"></a>';
            
            notificationContainer.appendChild(notification);
            
            // Auto-remove after 5 seconds
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 5000);
        }

        // Refresh domains data from server
        async function refreshDomainsData() {
            if (!currentJobId) {
                showGlobalNotification('No active job to refresh from.', 'warning');
                return;
            }
            
            try {
                const response = await fetch('/progress/' + currentJobId);
                if (response.ok) {
                    const progress = await response.json();
                    if (progress.successfulDomainsWithEvidence && progress.successfulDomainsWithEvidence.length > 0) {
                        domainsData = progress.successfulDomainsWithEvidence;
                        loadDomainsData();
                        showGlobalNotification('Data refreshed successfully!', 'success');
                    } else {
                        showGlobalNotification('No domain data available to refresh.', 'info');
                    }
                } else {
                    showGlobalNotification('Failed to refresh data from server.', 'danger');
                }
            } catch (error) {
                showGlobalNotification('Error refreshing data: ' + error.message, 'danger');
            }
        }

        // Load domains data and display in table
        function loadDomainsData() {
            // Check if we're on the domains page and elements exist
            const domainsPage = document.getElementById('domainsPage');
            const emptyState = document.getElementById('domainsEmptyState');
            const tableContainer = document.getElementById('domainsTableContainer');
            const progressIndicator = document.getElementById('domainsProgressIndicator');
            
            if (!domainsPage || !emptyState || !tableContainer) {
                console.log('Domains page elements not found, skipping loadDomainsData');
                return;
            }
            
            // Hide progress indicator when loading data
            if (progressIndicator) {
                progressIndicator.style.display = 'none';
            }
            
            if (domainsData.length === 0) {
                // No data available
                emptyState.style.display = 'block';
                tableContainer.innerHTML = '';
                
                // Update empty state message
                emptyState.innerHTML = 
                    '<div class="empty-state-icon">' +
                        '<i class="ti ti-search text-muted" style="font-size: 3rem;"></i>' +
                    '</div>' +
                    '<p class="empty-state-title">No domains found yet</p>' +
                    '<p class="empty-state-subtitle">Go to the Home page, upload a CSV file and start checking to see results here.</p>' +
                    '<div class="mt-3">' +
                        '<button class="btn btn-primary" onclick="showHomePage()">' +
                            '<i class="ti ti-home me-2"></i>' +
                            'Go to Home' +
                        '</button>' +
                    '</div>';
                return;
            }

            // Hide empty state
            emptyState.style.display = 'none';

            // Create Tabler data table
            const tableHTML = 
                '<div class="table-responsive">' +
                    '<table class="table table-vcenter card-table">' +
                        '<thead>' +
                            '<tr>' +
                                '<th>Domain</th>' +
                                '<th>Company Name</th>' +
                                '<th>Evidence</th>' +
                                '<th>Status</th>' +
                                '<th>Actions</th>' +
                            '</tr>' +
                        '</thead>' +
                        '<tbody>' +
                            domainsData.map(item => 
                                '<tr>' +
                                    '<td>' +
                                        '<div class="d-flex py-1 align-items-center">' +
                                            '<span class="avatar me-2 bg-primary-lt">' +
                                                '<i class="ti ti-world"></i>' +
                                            '</span>' +
                                            '<div class="flex-fill">' +
                                                '<div class="font-weight-medium">' + item.domain + '</div>' +
                                            '</div>' +
                                        '</div>' +
                                    '</td>' +
                                    '<td>' +
                                        '<div class="text-muted">' + (item.companyName || 'Not detected') + '</div>' +
                                    '</td>' +
                                    '<td>' +
                                        '<div class="text-muted small">' + item.evidence.join('; ') + '</div>' +
                                    '</td>' +
                                    '<td>' +
                                        '<span class="badge bg-success">Umbraco ✓</span>' +
                                    '</td>' +
                                    '<td>' +
                                        '<div class="btn-list">' +
                                            '<a href="https://' + item.domain + '" target="_blank" class="btn btn-sm btn-outline-primary">' +
                                                '<i class="ti ti-external-link me-1"></i>' +
                                                'Visit' +
                                            '</a>' +
                                        '</div>' +
                                    '</td>' +
                                '</tr>'
                            ).join('') +
                        '</tbody>' +
                    '</table>' +
                '</div>' +
                '<div class="d-flex justify-content-between align-items-center mt-3">' +
                    '<div class="text-muted">' +
                        'Showing ' + domainsData.length + ' domains' +
                    '</div>' +
                    '<div class="btn-list">' +
                        '<button class="btn btn-primary" onclick="downloadResults()">' +
                            '<i class="ti ti-download me-2"></i>' +
                            'Download CSV' +
                        '</button>' +
                        '<button class="btn btn-info" onclick="proceedToEmailExtraction()">' +
                            '<i class="ti ti-mail me-2"></i>' +
                            'Email Extraction' +
                        '</button>' +
                    '</div>' +
                '</div>';

            tableContainer.innerHTML = tableHTML;
        }

        // Navigation functions
        function showHomePage() {
            const homePage = document.getElementById('homePage');
            const domainsPage = document.getElementById('domainsPage');
            
            if (!homePage || !domainsPage) {
                console.error('Required page elements not found');
                return;
            }
            
            homePage.style.display = 'block';
            domainsPage.style.display = 'none';
            
            // Update navigation active states
            document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
            const homeLink = document.querySelector('.nav-link[onclick="showHomePage()"]');
            if (homeLink) {
                homeLink.classList.add('active');
            }
        }

        function showDomainsPage() {
            const homePage = document.getElementById('homePage');
            const domainsPage = document.getElementById('domainsPage');
            
            if (!homePage || !domainsPage) {
                console.error('Required page elements not found');
                return;
            }
            
            homePage.style.display = 'none';
            domainsPage.style.display = 'block';
            
            // Update navigation active states
            document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
            const domainsLink = document.querySelector('.nav-link[onclick="showDomainsPage()"]');
            if (domainsLink) {
                domainsLink.classList.add('active');
            }
            
            // Load domains data if available
            loadDomainsData();
            
            // Show notification if there's fresh data
            if (domainsData.length > 0) {
                showGlobalNotification('Loaded ' + domainsData.length + ' domains. Data is up to date.', 'info');
            }
        }

        // File upload handling
        const uploadSection = document.getElementById('uploadSection');
        const fileInput = document.getElementById('fileInput');
        const fileInfo = document.getElementById('fileInfo');
        const checkBtn = document.getElementById('checkBtn');
        const alerts = document.getElementById('alerts');

        function showAlert(message, type = 'danger') {
            const alert = document.createElement('div');
            // Map 'error' to 'danger' for Tabler.io compatibility
            const alertType = type === 'error' ? 'danger' : type;
            alert.className = \`alert alert-\${alertType} alert-dismissible\`;
            alert.innerHTML = \`
                \${message}
                <a href="#" class="btn-close" data-bs-dismiss="alert" aria-label="close"></a>
            \`;
            alerts.appendChild(alert);
            setTimeout(() => alert.remove(), 5000);
        }

        // Drag and drop events
        uploadSection.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadSection.classList.add('dragover');
        });

        uploadSection.addEventListener('dragleave', () => {
            uploadSection.classList.remove('dragover');
        });

        uploadSection.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadSection.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                handleFile(files[0]);
            }
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleFile(e.target.files[0]);
            }
        });

        async function handleFile(file) {
            if (!file.name.toLowerCase().endsWith('.csv')) {
                showAlert('Please select a CSV file.');
                return;
            }

            const formData = new FormData();
            formData.append('csvfile', file);

            try {
                const response = await fetch('/upload', {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();

                if (response.ok) {
                    uploadedFileName = result.filename;
                    fileInfo.innerHTML = \`<i class="ti ti-file me-2"></i><strong>\${file.name}</strong> - \${result.domainCount} domains loaded\`;
                    fileInfo.style.display = 'block';
                    checkBtn.style.display = 'inline-block';
                    showAlert(\`File uploaded successfully! \${result.domainCount} domains found.\`, 'success');
                } else {
                    showAlert(result.error || 'Upload failed');
                }
            } catch (error) {
                showAlert('Upload failed: ' + error.message);
            }
        }

        async function startChecking() {
            if (!uploadedFileName) {
                showAlert('Please upload a CSV file first.');
                return;
            }

            const checkMethod = document.getElementById('checkMethod').value;

            try {
                const response = await fetch('/check', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        filename: uploadedFileName,
                        method: checkMethod
                    })
                });

                const result = await response.json();

                if (response.ok) {
                    checkJobId = result.jobId;
                    currentJobId = result.jobId; // Store globally for refresh functionality
                    document.getElementById('progressContainer').style.display = 'block';
                    document.getElementById('checkBtn').style.display = 'none';
                    document.getElementById('stopBtn').style.display = 'inline-block';
                    document.getElementById('totalCount').textContent = result.totalDomains;
                    
                    // Start polling for progress
                    pollProgress();
                } else {
                    showAlert(result.error || 'Failed to start checking');
                }
            } catch (error) {
                showAlert('Failed to start checking: ' + error.message);
            }
        }

        async function stopChecking() {
            if (checkJobId) {
                try {
                    await fetch(\`/stop/\${checkJobId}\`, { method: 'POST' });
                    showAlert('Checking stopped by user.', 'success');
                } catch (error) {
                    showAlert('Failed to stop checking: ' + error.message);
                }
            }
        }

        async function pollProgress() {
            if (!checkJobId) return;

            try {
                const response = await fetch(\`/progress/\${checkJobId}\`);
                const progress = await response.json();

                if (response.ok) {
                    updateProgress(progress);
                    
                    if (progress.status === 'completed' || progress.status === 'stopped') {
                        document.getElementById('checkBtn').style.display = 'inline-block';
                        document.getElementById('stopBtn').style.display = 'none';
                        
                        if (progress.status === 'completed') {
                            showAlert(\`Checking completed! \${progress.successCount} domains responded with 200.\`, 'success');
                        }
                    } else {
                        // Continue polling
                        setTimeout(pollProgress, 1000);
                    }
                } else {
                    showAlert('Failed to get progress update');
                }
            } catch (error) {
                showAlert('Progress update failed: ' + error.message);
                setTimeout(pollProgress, 2000); // Retry after 2 seconds
            }
        }

        function updateProgress(progress) {
            // Store the data globally regardless of current page
            if (progress.successfulDomainsWithEvidence && progress.successfulDomainsWithEvidence.length > 0) {
                domainsData = progress.successfulDomainsWithEvidence;
            }
            
            // Check if we're on the home page
            const homePage = document.getElementById('homePage');
            if (!homePage || homePage.style.display === 'none') {
                // We're not on the home page, update domains page progress if it exists
                updateDomainsPageProgress(progress);
                
                // Show global notification for completion
                if (progress.status === 'completed') {
                    const message = 'Domain checking completed! ' + progress.successCount + ' domains found. Go to "View Domains" to see results.';
                    showGlobalNotification(message, 'success');
                } else if (progress.status === 'stopped') {
                    showGlobalNotification('Domain checking stopped by user.', 'warning');
                }
                return;
            }

            const progressFill = document.getElementById('progressFill');
            const status = document.getElementById('status');
            const checkedCount = document.getElementById('checkedCount');
            const successCount = document.getElementById('successCount');
            const successList = document.getElementById('successList');
            const results = document.getElementById('results');
            const emptyState = document.getElementById('emptyState');

            // Check if all required elements exist before proceeding
            if (!progressFill || !status || !checkedCount || !successCount || !successList || !results || !emptyState) {
                console.log('Some DOM elements not found, skipping progress update');
                return;
            }

            const percentage = progress.total > 0 ? (progress.checked / progress.total) * 100 : 0;
            progressFill.style.width = percentage + '%';
            progressFill.setAttribute('aria-valuenow', percentage);
            
            // Update progress text
            const progressText = document.getElementById('progressText');
            if (progressText) {
                progressText.textContent = Math.round(percentage) + '%';
            }
            
            if (progress.currentDomain) {
                status.innerHTML = '<div class="loading-spinner"></div>Checking: <strong>' + progress.currentDomain + '</strong>';
            } else {
                status.innerHTML = progress.status === 'completed' ? '<i class="ti ti-check text-success me-2"></i>Checking completed!' : 
                                   progress.status === 'stopped' ? '<i class="ti ti-square text-warning me-2"></i>Checking stopped.' : 
                                   '<i class="ti ti-loader me-2"></i>Processing...';
            }

            checkedCount.textContent = progress.checked;
            successCount.textContent = progress.successCount;

            // Update successful domains list with evidence
            successList.innerHTML = '';
            
            if (progress.successfulDomainsWithEvidence && progress.successfulDomainsWithEvidence.length > 0) {
                progress.successfulDomainsWithEvidence.forEach(item => {
                    const domainItem = document.createElement('div');
                    domainItem.className = 'domain-item';
                    domainItem.innerHTML = 
                        '<div class="d-flex justify-content-between align-items-start w-100">' +
                            '<div class="flex-grow-1 me-3">' +
                                '<div class="fw-bold text-primary">' + item.domain + '</div>' +
                                '<div class="text-muted small">' + item.evidence.join('; ') + '</div>' +
                            '</div>' +
                            '<span class="badge bg-success">Umbraco ✓</span>' +
                        '</div>';
                    successList.appendChild(domainItem);
                });
            } else if (progress.successfulDomains && progress.successfulDomains.length > 0) {
                // Fallback for backward compatibility
                progress.successfulDomains.forEach(domain => {
                    const domainItem = document.createElement('div');
                    domainItem.className = 'domain-item';
                    domainItem.innerHTML = 
                        '<div class="d-flex justify-content-between align-items-start w-100">' +
                            '<div class="flex-grow-1 me-3">' +
                                '<div class="fw-bold text-primary">' + domain + '</div>' +
                                '<div class="text-muted small">Evidence not available</div>' +
                            '</div>' +
                            '<span class="badge bg-secondary">200 OK</span>' +
                        '</div>';
                    successList.appendChild(domainItem);
                });
            }

            if (progress.successfulDomains.length > 0) {
                results.style.display = 'block';
                emptyState.style.display = 'none';
                // Show email extraction button when we have successful domains
                const emailExtractBtn = document.getElementById('emailExtractBtn');
                if (emailExtractBtn) {
                    emailExtractBtn.style.display = 'inline-block';
                }
                
                // Store domains data globally for the table view
                domainsData = progress.successfulDomainsWithEvidence || [];
            } else {
                emptyState.style.display = 'block';
            }
        }

        async function downloadResults() {
            if (!checkJobId) {
                showAlert('No results to download.');
                return;
            }

            try {
                const response = await fetch(\`/download/\${checkJobId}\`);
                
                if (response.ok) {
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'successful_domains.csv';
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                    showAlert('Results downloaded successfully!', 'success');
                } else {
                    const result = await response.json();
                    showAlert(result.error || 'Download failed');
                }
            } catch (error) {
                showAlert('Download failed: ' + error.message);
            }
        }

        async function proceedToEmailExtraction() {
            if (!checkJobId) {
                showAlert('No results to proceed with.');
                return;
            }

            try {
                // Download the domains CSV for email extraction
                const response = await fetch(\`/download-email-extraction/\${checkJobId}\`);
                
                if (response.ok) {
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'umbraco_domains_for_email_extraction.csv';
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);

                    // Get the count of domains
                    const progressResponse = await fetch(\`/progress/\${checkJobId}\`);
                    const progress = await progressResponse.json();
                    const domainCount = progress.successfulDomains ? progress.successfulDomains.length : 0;

                    // Show instructions for email extraction
                    showAlert(\`✅ Downloaded \${domainCount} domains for email extraction!\\n\\n📧 Next steps:\\n1. Go to http://localhost:3001 (Email Extractor)\\n2. Upload the downloaded CSV file\\n3. Start email extraction process\`, 'success');

                    // Open email extractor in new tab
                    setTimeout(() => {
                        window.open('http://localhost:3001', '_blank');
                    }, 2000);
                } else {
                    const result = await response.json();
                    showAlert(result.error || 'Failed to download domains for email extraction');
                }

            } catch (error) {
                showAlert('Failed to proceed with email extraction: ' + error.message);
            }
        }
    </script>
</body>
</html>
  `);
});

// Upload CSV file
app.post('/upload', upload.single('csvfile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // Detect which column contains domains
  let domainCol = null;
  let domains = [];
  let firstRow = null;
  let rowCount = 0;

  fs.createReadStream(req.file.path)
    .pipe(parse({ columns: false, skip_empty_lines: true }))
    .on('data', (row) => {
      rowCount++;
      if (rowCount === 1) {
        // Try to detect domain column in first row
        for (let i = 0; i < row.length; i++) {
          const cell = (row[i] || '').toLowerCase();
          // Heuristic: contains a dot, no spaces, not a header
          if (
            cell.includes('.') &&
            !cell.includes(' ') &&
            !cell.includes('@') && // skip emails
            !['domain', 'website', 'url'].includes(cell)
          ) {
            domainCol = i;
            break;
          }
        }
        // If not found, fallback to header names
        if (domainCol === null) {
          for (let i = 0; i < row.length; i++) {
            const cell = (row[i] || '').toLowerCase();
            if (['domain', 'website', 'url'].includes(cell)) {
              domainCol = i;
              break;
            }
          }
        }
        // If still not found, fallback to column 2 (index 2)
        if (domainCol === null) domainCol = 2;
        firstRow = row;
      } else {
        // Use detected column
        const cell = row[domainCol];
        if (cell && cell.toLowerCase() !== 'domain') {
          let domain = cell.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
          if (domain) domains.push(domain);
        }
      }
    })
    .on('end', () => {
      // Store the detected column index for this file
      fileDomainColumnIndex.set(req.file.filename, domainCol);
      res.json({
        success: true,
        filename: req.file.filename,
        domainCount: domains.length,
        domainColumn: domainCol,
        sampleDomain: domains[0] || null
      });
    })
    .on('error', (error) => {
      res.status(500).json({ error: 'Failed to parse CSV: ' + error.message });
    });
});

// Start domain checking
app.post('/check', async (req, res) => {
  const { filename, method = 'http' } = req.body;

  if (!filename) {
    return res.status(400).json({ error: 'No filename provided' });
  }

  const filePath = path.join(__dirname, 'uploads', filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Get the detected domain column index for this file
  const domainCol = fileDomainColumnIndex.get(filename) ?? 2;

  // Generate unique job ID
  const jobId = Date.now().toString();

  // Parse domains from CSV using detected column
  const domains = [];
  let rowCount = 0;
  fs.createReadStream(filePath)
    .pipe(parse({ columns: false, skip_empty_lines: true }))
    .on('data', (row) => {
      rowCount++;
      // Skip header row if it matches
      if (rowCount === 1 && ['domain', 'website', 'url'].includes((row[domainCol] || '').toLowerCase())) {
        return;
      }
      const cell = row[domainCol];
      if (cell && cell.toLowerCase() !== 'domain') {
        let domain = cell.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
        if (domain) domains.push(domain);
      }
    })
    .on('end', () => {
      // Initialize job progress
      activeChecks.set(jobId, {
        status: 'running',
        total: domains.length,
        checked: 0,
        successCount: 0,
        successfulDomains: [],
        successfulDomainsWithEvidence: [],
        currentDomain: null,
        startTime: Date.now()
      });

      // Start checking domains in background using HTTP method
      checkDomainsWithHTTP(jobId, domains);

      res.json({
        success: true,
        jobId: jobId,
        totalDomains: domains.length
      });
    })
    .on('error', (error) => {
      res.status(500).json({ error: 'Failed to parse CSV: ' + error.message });
    });
});

// Get progress for a job
app.get('/progress/:jobId', (req, res) => {
  const { jobId } = req.params;
  const progress = activeChecks.get(jobId);
  
  if (!progress) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  res.json(progress);
});

// Stop a checking job
app.post('/stop/:jobId', (req, res) => {
  const { jobId } = req.params;
  const progress = activeChecks.get(jobId);
  
  if (!progress) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  progress.status = 'stopped';
  res.json({ success: true });
});

// Download results
app.get('/download/:jobId', (req, res) => {
  const { jobId } = req.params;
  const progress = activeChecks.get(jobId);
  
  if (!progress) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  if (progress.successfulDomains.length === 0) {
    return res.status(400).json({ error: 'No successful domains to download' });
  }

  // Generate CSV with evidence and company names
  const csvData = [['Domain', 'Company Name', 'Evidence']];
  progress.successfulDomainsWithEvidence.forEach(item => {
    csvData.push([item.domain, item.companyName || 'Not detected', item.evidence.join('; ')]);
  });
  
  stringify(csvData, (err, output) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to generate CSV' });
    }
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="umbraco_domains_with_evidence.csv"');
    res.send(output);
  });
});

// Download domains for email extraction (simplified CSV)
app.get('/download-email-extraction/:jobId', (req, res) => {
  const { jobId } = req.params;
  const progress = activeChecks.get(jobId);
  
  if (!progress) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  if (progress.successfulDomains.length === 0) {
    return res.status(400).json({ error: 'No successful domains to download' });
  }

  // Generate simplified CSV with just domains for email extraction
  const csvData = [['Domain']];
  progress.successfulDomains.forEach(domain => {
    csvData.push([domain]);
  });
  
  stringify(csvData, (err, output) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to generate CSV' });
    }
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="umbraco_domains_for_email_extraction.csv"');
    res.send(output);
  });
});


// Lightweight HTTP-based domain checking function
async function checkDomainsWithHTTP(jobId, domains) {
  const progress = activeChecks.get(jobId);
  
  try {
    for (let i = 0; i < domains.length; i++) {
      // Check if job was stopped
      if (progress.status === 'stopped') {
        break;
      }

      const domain = domains[i];
      progress.currentDomain = domain;
      progress.checked = i + 1;

      console.log(`Checking ${i + 1}/${domains.length}: ${domain}`);

      try {
        // Try HTTPS first, then HTTP as fallback
        console.log(`🔍 ${domain} - Checking for Umbraco...`);
        const results = await checkDomainWithHTTP(domain);
        
        if (results.isUmbraco) {
          progress.successfulDomains.push(domain);
          progress.successfulDomainsWithEvidence.push({
            domain: domain,
            evidence: results.evidence,
            companyName: results.companyName || 'Not detected'
          });
          progress.successCount++;
          console.log(`✓ ${domain} - Umbraco detected! Evidence: ${results.evidence.join('; ')} Company: ${results.companyName || 'Not detected'}`);
        } else {
          console.log(`✗ ${domain} - No Umbraco evidence found`);
        }

      } catch (error) {
        console.log(`✗ ${domain} - Error: ${error.message}`);
      }

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    progress.status = progress.status === 'stopped' ? 'stopped' : 'completed';
    progress.currentDomain = null;
    
  } catch (error) {
    console.error('Processing error:', error);
    progress.status = 'error';
    progress.error = error.message;
  }
  
  console.log(`Job ${jobId} finished. ${progress.successCount}/${domains.length} domains successful.`);
}

// Check a single domain using HTTP requests
async function checkDomainWithHTTP(domain) {
  return new Promise(async (resolve, reject) => {
    let isUmbraco = false;
    let evidence = [];
    let companyName = '';
    
    // Try HTTPS first
    try {
      const httpsResult = await makeHTTPRequest(`https://${domain}/umbraco/`, true);
      if (httpsResult.success) {
        isUmbraco = httpsResult.isUmbraco;
        evidence = httpsResult.evidence;
        companyName = httpsResult.companyName || '';
        if (isUmbraco) {
          return resolve({ isUmbraco, evidence, companyName });
        }
      }
    } catch (error) {
      console.log(`🔄 ${domain} - HTTPS failed: ${error.message}`);
    }

    // Try HTTP as fallback
    try {
      const httpResult = await makeHTTPRequest(`http://${domain}/umbraco/`, false);
      if (httpResult.success) {
        isUmbraco = httpResult.isUmbraco;
        evidence = httpResult.evidence;
        companyName = httpResult.companyName || '';
      }
    } catch (error) {
      console.log(`🔄 ${domain} - HTTP also failed: ${error.message}`);
    }

    resolve({ isUmbraco, evidence, companyName });
  });
}

// Make HTTP request and analyze response with redirect following
async function makeHTTPRequest(url, isHTTPS, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    // Prevent infinite redirect loops (max 5 redirects)
    if (redirectCount > 5) {
      reject(new Error('Too many redirects (max 5)'));
      return;
    }
    
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHTTPS ? 443 : 80),
      path: urlObj.pathname,
      method: 'GET',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'close'
      }
    };

    const client = isHTTPS ? https : http;
    const req = client.request(options, (res) => {
      // Check for redirects and follow them until we get a 200 response
      if (res.statusCode === 301 || res.statusCode === 302) {
        const location = res.headers.location;
        if (location) {
          // Handle relative redirects by constructing absolute URL
          let redirectUrl = location;
          if (location.startsWith('/')) {
            redirectUrl = `${isHTTPS ? 'https://' : 'http://'}${urlObj.hostname}${location}`;
          } else if (!location.startsWith('http')) {
            redirectUrl = `${isHTTPS ? 'https://' : 'http://'}${urlObj.hostname}/${location}`;
          }
          
          // Log redirect information
          if (redirectCount === 0) {
            console.log(`🔄 ${urlObj.hostname} - Following redirect: ${url} → ${redirectUrl}`);
          }
          
          // Follow the redirect recursively
          makeHTTPRequest(redirectUrl, redirectUrl.startsWith('https://'), redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }
      }
      
      // Only analyze content if we have a 200 response
      if (res.statusCode !== 200) {
        resolve({
          success: true,
          isUmbraco: false,
          evidence: [`Status code: ${res.statusCode}`]
        });
        return;
      }
      
      let data = '';
      
      // Handle gzip compression
      let stream = res;
      if (res.headers['content-encoding'] === 'gzip') {
        const zlib = require('zlib');
        stream = res.pipe(zlib.createGunzip());
      } else if (res.headers['content-encoding'] === 'deflate') {
        const zlib = require('zlib');
        stream = res.pipe(zlib.createInflate());
      }
      
      stream.on('data', (chunk) => {
        data += chunk;
      });
      
      stream.on('end', () => {
        try {
          const isUmbraco = analyzeResponseForUmbraco(data, res.headers, res.statusCode, url);
          const companyName = extractCompanyName(data, url);
          resolve({
            success: true,
            isUmbraco: isUmbraco.isUmbraco,
            evidence: isUmbraco.evidence,
            companyName: companyName
          });
        } catch (error) {
          reject(error);
        }
      });
      
      stream.on('error', (error) => {
        reject(error);
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

// Analyze response for Umbraco indicators
function analyzeResponseForUmbraco(content, headers, statusCode, url) {
  let isUmbraco = false;
  let evidence = [];
  
  // Check status code - if we get a 200 response to /umbraco/, it's likely Umbraco
  if (statusCode === 200) {
    // Method 1: Direct Umbraco path access (strongest indicator)
    if (url.includes('/umbraco/')) {
      isUmbraco = true;
      evidence.push('Direct access to /umbraco/ path returned 200');
    }
    
    // Method 2: Check HTML content for Umbraco indicators
    if (content.toLowerCase().includes('umbraco')) {
      isUmbraco = true;
      evidence.push('HTML content contains Umbraco references');
    }
    
    // Method 3: Check for .aspx extensions (common in Umbraco)
    if (url.includes('.aspx') || content.includes('.aspx')) {
      isUmbraco = true;
      evidence.push('Found .aspx extensions (common in Umbraco)');
    }
    
    // Method 4: Check for ASP.NET indicators (Umbraco is built on ASP.NET)
    if (content.includes('__VIEWSTATE') || 
        content.includes('__EVENTVALIDATION') ||
        content.includes('asp:') ||
        content.includes('runat="server"')) {
      isUmbraco = true;
      evidence.push('Found ASP.NET indicators (Umbraco is ASP.NET-based)');
    }
    
    // Method 5: Check for common Umbraco file extensions and paths
    if (content.includes('.ashx') || 
        content.includes('.asmx') ||
        content.includes('umbraco.webservices') ||
        content.includes('umbraco.config')) {
      isUmbraco = true;
      evidence.push('Found Umbraco-specific file references');
    }
  } else if (statusCode === 403 || statusCode === 401) {
    // These status codes often indicate Umbraco admin access is restricted
    // which is a good sign that Umbraco is installed
    isUmbraco = true;
    evidence.push('Status code ' + statusCode + ' - Umbraco admin access restricted');
  } else if (statusCode === 404) {
    // Check if the 404 page contains Umbraco references
    if (content.toLowerCase().includes('umbraco')) {
      isUmbraco = true;
      evidence.push('404 page contains Umbraco references');
    }
  }

  return { isUmbraco, evidence };
}

// Extract company name from HTML content
function extractCompanyName(content, url) {
  let companyName = '';
  
  try {
    // Method 1: Look for title tag
    const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      let title = titleMatch[1].trim();
      // Clean up title - remove common suffixes
      title = title.replace(/\s*[-|]\s*(Home|Welcome|Official Site|Website).*$/i, '');
      if (title.length > 3 && title.length < 100) {
        companyName = title;
      }
    }
    
    // Method 2: Look for h1 tags
    if (!companyName) {
      const h1Match = content.match(/<h1[^>]*>([^<]+)<\/h1>/i);
      if (h1Match && h1Match[1]) {
        let h1Text = h1Match[1].trim();
        h1Text = h1Text.replace(/\s*[-|]\s*(Home|Welcome|Official Site|Website).*$/i, '');
        if (h1Text.length > 3 && h1Text.length < 100) {
          companyName = h1Text;
        }
      }
    }
    
    // Method 3: Look for logo alt text
    if (!companyName) {
      const logoMatch = content.match(/<img[^>]*alt=["']([^"']+)["'][^>]*>/i);
      if (logoMatch && logoMatch[1]) {
        let altText = logoMatch[1].trim();
        altText = altText.replace(/\s*(logo|brand|company).*$/i, '');
        if (altText.length > 3 && altText.length < 100) {
          companyName = altText;
        }
      }
    }
    
    // Method 4: Extract from domain if no other name found
    if (!companyName) {
      const domain = new URL(url).hostname;
      companyName = domain.replace(/^www\./, '').split('.')[0];
      // Capitalize first letter
      companyName = companyName.charAt(0).toUpperCase() + companyName.slice(1);
    }
    
    // Clean up the company name
    if (companyName) {
      companyName = companyName.replace(/[^\w\s\-&]/g, '').trim();
      // Limit length
      if (companyName.length > 50) {
        companyName = companyName.substring(0, 50) + '...';
      }
    }
    
  } catch (error) {
    console.log('Error extracting company name:', error.message);
  }
  
  return companyName || 'Not detected';
}

// Cleanup old files and jobs periodically
setInterval(() => {
  const uploadsDir = './uploads';
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours

  // Clean up old uploaded files
  if (fs.existsSync(uploadsDir)) {
    fs.readdirSync(uploadsDir).forEach(file => {
      const filePath = path.join(uploadsDir, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtime.getTime() > maxAge) {
        fs.unlinkSync(filePath);
      }
    });
  }

  // Clean up old job data
  for (const [jobId, progress] of activeChecks.entries()) {
    if (now - progress.startTime > maxAge) {
      activeChecks.delete(jobId);
    }
  }
}, 60 * 60 * 1000); // Run cleanup every hour

app.listen(PORT, () => {
  console.log(`🚀 Domain CSV Checker running on http://localhost:${PORT}`);
  console.log('📁 Upload a CSV file with domain names to get started!');
});
