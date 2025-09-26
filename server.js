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
    <title>BlueDetect - Umbraco CMS Detector</title>
    <link href="https://cdn.jsdelivr.net/npm/@tabler/core@1.0.0-beta20/dist/css/tabler.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/@tabler/icons@2.40.0/icons-sprite.svg" rel="stylesheet">
    <style>
        .page-wrapper {
            min-height: 100vh;
            background: #f8f9fa;
        }
        .upload-zone {
            border: 2px dashed #206bc4;
            border-radius: 8px;
            padding: 2rem;
            text-align: center;
            transition: all 0.3s ease;
            cursor: pointer;
            height: 100%;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }
        .upload-zone:hover {
            border-color: #206bc4;
            background: rgba(32, 107, 196, 0.05);
        }
        .upload-zone.dragover {
            border-color: #206bc4;
            background: rgba(32, 107, 196, 0.1);
        }
        .results-table {
            display: none;
        }
        .page-section {
            display: none;
        }
        .page-section.active {
            display: block;
        }
        .confidence-badge {
            font-size: 0.75rem;
            padding: 0.25rem 0.5rem;
            color: white !important;
        }
        .score-badge {
            font-size: 0.75rem;
            padding: 0.25rem 0.5rem;
            color: white !important;
        }
        .file-info-panel {
            height: 100%;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }
        .sortable {
            user-select: none;
        }
        .sortable:hover {
            background-color: rgba(0, 0, 0, 0.05);
        }
    </style>
</head>
<body class="page-wrapper">
    <div class="page">
        <!-- Navigation -->
        <header class="navbar navbar-expand-md navbar-dark">
            <div class="container-xl">
                <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbar-menu">
                    <span class="navbar-toggler-icon"></span>
                </button>
                <h1 class="navbar-brand navbar-brand-autodark">
                    <a href="#" class="nav-link">
                        <span class="text-primary">Blue</span><span class="text-white">Detect</span>
                    </a>
                </h1>
                <div class="navbar-nav flex-row order-md-last">
                    <div class="nav-item dropdown">
                        <a href="#" class="nav-link d-flex lh-1 text-reset p-0" data-bs-toggle="dropdown">
                            <span class="avatar avatar-sm" style="background-image: url(https://ui-avatars.com/api/?name=User&background=206bc4&color=fff)"></span>
                        </a>
                    </div>
                </div>
                <div class="collapse navbar-collapse" id="navbar-menu">
                    <div class="d-flex flex-column flex-md-row flex-fill align-items-stretch align-items-md-center">
                        <ul class="navbar-nav">
                            <li class="nav-item">
                                <a class="nav-link" href="#" onclick="showPage('home')">
                                    <span class="nav-link-icon d-md-none d-lg-inline-block">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="icon" width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><polyline points="5,12 3,12 12,3 21,12 19,12" /><path d="M5,12v7a2,2 0 0,0 2,2h10a2,2 0 0,0 2,-2v-7" /><path d="M9,21v-6a2,2 0 0,1 2,-2h2a2,2 0 0,1 2,2v6" /></svg>
                                    </span>
                                    <span class="nav-link-title">Home</span>
                                </a>
                            </li>
                            <li class="nav-item">
                                <a class="nav-link" href="#" onclick="showPage('results')">
                                    <span class="nav-link-icon d-md-none d-lg-inline-block">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="icon" width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><circle cx="9" cy="19" r="2" /><circle cx="20" cy="19" r="2" /><path d="M1,1h4l2.68,13.39a2,2 0 0,0 2,1.61h9.72a2,2 0 0,0 2,-1.61L23,6H6" /></svg>
                                    </span>
                                    <span class="nav-link-title">Results</span>
                                </a>
                            </li>
                            <li class="nav-item">
                                <a class="nav-link" href="#" onclick="showPage('detection')">
                                    <span class="nav-link-icon d-md-none d-lg-inline-block">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="icon" width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M10,10m-7,0a7,7 0 1,0 14,0a7,7 0 1,0 -14,0" /><path d="M21,21l-6,-6" /></svg>
                                    </span>
                                    <span class="nav-link-title">Detection</span>
                                </a>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </header>

        <!-- Home Page -->
        <div id="home-page" class="page-section active">
            <div class="page-header">
                <div class="container-xl">
                    <div class="row g-2 align-items-center">
                        <div class="col">
                            <h2 class="page-title">Umbraco CMS Detector</h2>
                            <div class="text-muted mt-1">Advanced Umbraco detection with evidence analysis</div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="page-body">
                <div class="container-xl">
                    <div class="row">
                        <div class="col-12">
                            <div class="card">
                                <div class="card-body">
                                    <div class="row">
                                        <!-- Upload Zone - 1/3 width -->
                                        <div class="col-md-4">
                                            <div class="upload-zone" id="uploadSection">
                                                <div class="mb-3">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="icon icon-lg text-muted" width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
                                                        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                                        <path d="M14,3v4a1,1 0 0,0 1,1h4" />
                                                        <path d="M17,21h-10a2,2 0 0,1 -2,-2v-14a2,2 0 0,1 2,-2h7l5,5v11a2,2 0 0,1 -2,2z" />
                                                        <line x1="12" y1="11" x2="12" y2="17" />
                                                        <polyline points="9,14 12,11 15,14" />
                                                    </svg>
                                                </div>
                                                <h3 class="card-title">Upload CSV File</h3>
                                                <p class="text-muted">Drag & drop your CSV file here or click to browse</p>
                                                <button class="btn btn-primary" onclick="document.getElementById('fileInput').click()">
                                                    Choose CSV File
                                                </button>
                                                <input type="file" id="fileInput" accept=".csv" style="display: none;" />
                                            </div>
                                        </div>
                                        
                                        <!-- File Info Panel - 2/3 width -->
                                        <div class="col-md-8">
                                            <div class="file-info-panel">
                                                <div id="fileInfo" class="card" style="display: none;">
                                                    <div class="card-body text-center">
                                                        <div class="mb-3">
                                                            <svg xmlns="http://www.w3.org/2000/svg" class="icon icon-lg text-success" width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
                                                                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                                                <path d="M14,3v4a1,1 0 0,0 1,1h4" />
                                                                <path d="M17,21h-10a2,2 0 0,1 -2,-2v-14a2,2 0 0,1 2,-2h7l5,5v11a2,2 0 0,1 -2,2z" />
                                                                <path d="M9,9l1,1l3,-3" />
                                                            </svg>
                                                        </div>
                                                        <h4 class="card-title">File Uploaded</h4>
                                                        <div id="fileDetails" class="text-muted"></div>
                                                        <div class="mt-3">
                                                            <button id="checkBtn" class="btn btn-success" style="display: none;" onclick="startChecking()">
                                                                🚀 Start Checking Domains
                                                            </button>
                                                            <button id="stopBtn" class="btn btn-danger" style="display: none;" onclick="stopChecking()">
                                                                ⏹️ Stop Checking
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                                
                                                <div id="progressContainer" style="display: none;">
                                                    <div class="card">
                                                        <div class="card-body">
                                                            <div class="progress mb-3">
                                                                <div class="progress-bar" id="progressFill" style="width: 0%"></div>
                                                            </div>
                                                            <div class="text-center mb-3" id="status"></div>
                                                            <div class="row">
                                                                <div class="col-4">
                                                                    <div class="text-center">
                                                                        <div class="h3 m-0" id="totalCount">0</div>
                                                                        <div class="text-muted small">Total</div>
                                                                    </div>
                                                                </div>
                                                                <div class="col-4">
                                                                    <div class="text-center">
                                                                        <div class="h3 m-0" id="checkedCount">0</div>
                                                                        <div class="text-muted small">Checked</div>
                                                                    </div>
                                                                </div>
                                                                <div class="col-4">
                                                                    <div class="text-center">
                                                                        <div class="h3 m-0" id="successCount">0</div>
                                                                        <div class="text-muted small">Found</div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div id="alerts"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Results Page -->
        <div id="results-page" class="page-section">
            <div class="page-header">
                <div class="container-xl">
                    <div class="row g-2 align-items-center">
                        <div class="col">
                            <h2 class="page-title">Detection Results</h2>
                            <div class="text-muted mt-1">Umbraco sites detected from your scan</div>
                        </div>
                        <div class="col-auto ms-auto d-print-none">
                            <button class="btn btn-primary" id="exportBtn" onclick="exportToCSV()" style="display: none;">
                                <svg xmlns="http://www.w3.org/2000/svg" class="icon" width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
                                    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                    <path d="M14,3v4a1,1 0 0,0 1,1h4" />
                                    <path d="M17,21h-10a2,2 0 0,1 -2,-2v-14a2,2 0 0,1 2,-2h7l5,5v11a2,2 0 0,1 -2,2z" />
                                    <line x1="12" y1="11" x2="12" y2="17" />
                                    <polyline points="9,14 12,11 15,14" />
                                </svg>
                                Export CSV
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="page-body">
                <div class="container-xl">
                    <div class="card">
                        <div class="card-body">
                            <div id="results-table" class="table-responsive">
                                <table class="table table-vcenter card-table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th onclick="sortTable('domain')" style="cursor: pointer;" class="sortable">
                                                Domain Name
                                            </th>
                                            <th>Company Name</th>
                                            <th onclick="sortTable('umbraco')" style="cursor: pointer;" class="sortable">
                                                Umbraco
                                            </th>
                                            <th onclick="sortTable('score')" style="cursor: pointer;" class="sortable">
                                                Score
                                            </th>
                                            <th onclick="sortTable('confidence')" style="cursor: pointer;" class="sortable">
                                                Confidence
                                            </th>
                                            <th>Reason</th>
                                        </tr>
                                    </thead>
                                    <tbody id="resultsTableBody">
                                        <tr>
                                            <td colspan="7" class="text-center text-muted">No results yet. Start a scan to see detected Umbraco sites.</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Detection Page -->
        <div id="detection-page" class="page-section">
            <div class="page-header">
                <div class="container-xl">
                    <div class="row g-2 align-items-center">
                        <div class="col">
                            <h2 class="page-title">Detection Methods</h2>
                            <div class="text-muted mt-1">How BlueDetect identifies Umbraco CMS</div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="page-body">
                <div class="container-xl">
                    <div class="row">
                        <div class="col-12">
                            <div class="card">
                                <div class="card-header">
                                    <h3 class="card-title">Weighted Scoring System</h3>
                                </div>
                                <div class="card-body">
                                    <p class="text-muted">BlueDetect uses a comprehensive weighted scoring system to identify Umbraco CMS installations. A minimum score of 3 points is required for positive detection.</p>
                                    
                                    <div class="row">
                                        <div class="col-md-4">
                                            <div class="card">
                                                <div class="card-header">
                                                    <h4 class="card-title text-success">Primary Indicators (3 points each)</h4>
                                                </div>
                                                <div class="card-body">
                                                    <ul class="list list-timeline">
                                                        <li>
                                                            <div class="list-timeline-icon bg-success"></div>
                                                            <div class="list-timeline-content">
                                                                <div class="list-timeline-title">Admin Path Detection</div>
                                                                <div class="text-muted">/umbraco/ path accessibility</div>
                                                            </div>
                                                        </li>
                                                        <li>
                                                            <div class="list-timeline-icon bg-success"></div>
                                                            <div class="list-timeline-content">
                                                                <div class="list-timeline-title">Umbraco File Paths</div>
                                                                <div class="text-muted">/App_Plugins/, /umbraco_client/, /Views/</div>
                                                            </div>
                                                        </li>
                                                    </ul>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="col-md-4">
                                            <div class="card">
                                                <div class="card-header">
                                                    <h4 class="card-title text-warning">Secondary Indicators (2 points each)</h4>
                                                </div>
                                                <div class="card-body">
                                                    <ul class="list list-timeline">
                                                        <li>
                                                            <div class="list-timeline-icon bg-warning"></div>
                                                            <div class="list-timeline-content">
                                                                <div class="list-timeline-title">ASP.NET/IIS Headers</div>
                                                                <div class="text-muted">x-aspnet-version, x-powered-by</div>
                                                            </div>
                                                        </li>
                                                        <li>
                                                            <div class="list-timeline-icon bg-warning"></div>
                                                            <div class="list-timeline-content">
                                                                <div class="list-timeline-title">Directory Structures</div>
                                                                <div class="text-muted">App_Plugins, umbraco_client</div>
                                                            </div>
                                                        </li>
                                                        <li>
                                                            <div class="list-timeline-icon bg-warning"></div>
                                                            <div class="list-timeline-content">
                                                                <div class="list-timeline-title">Client Dependency Framework</div>
                                                                <div class="text-muted">umbraco.clientdependency patterns</div>
                                                            </div>
                                                        </li>
                                                    </ul>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="col-md-4">
                                            <div class="card">
                                                <div class="card-header">
                                                    <h4 class="card-title text-info">Tertiary Indicators (1 point each)</h4>
                                                </div>
                                                <div class="card-body">
                                                    <ul class="list list-timeline">
                                                        <li>
                                                            <div class="list-timeline-icon bg-info"></div>
                                                            <div class="list-timeline-content">
                                                                <div class="list-timeline-title">ASPX Extensions</div>
                                                                <div class="text-muted">.NET application patterns</div>
                                                            </div>
                                                        </li>
                                                        <li>
                                                            <div class="list-timeline-icon bg-info"></div>
                                                            <div class="list-timeline-content">
                                                                <div class="list-timeline-title">HTML Elements</div>
                                                                <div class="text-muted">Umbraco-specific CSS classes</div>
                                                            </div>
                                                        </li>
                                                        <li>
                                                            <div class="list-timeline-icon bg-info"></div>
                                                            <div class="list-timeline-content">
                                                                <div class="list-timeline-title">JavaScript References</div>
                                                                <div class="text-muted">umbraco.js, umbraco_client</div>
                                                            </div>
                                                        </li>
                                                        <li>
                                                            <div class="list-timeline-icon bg-info"></div>
                                                            <div class="list-timeline-content">
                                                                <div class="list-timeline-title">Text Patterns</div>
                                                                <div class="text-muted">General Umbraco mentions</div>
                                                            </div>
                                                        </li>
                                                    </ul>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="card">
                                <div class="card-header">
                                    <h3 class="card-title">Exclusion System</h3>
                                </div>
                                <div class="card-body">
                                    <p class="text-muted">BlueDetect automatically excludes sites that use other CMS platforms by checking meta generator tags for:</p>
                                    <div class="row">
                                        <div class="col-md-6">
                                            <h5>Traditional CMS</h5>
                                            <ul>
                                                <li>WordPress, Drupal, Joomla</li>
                                                <li>TYPO3, MODX, Concrete5</li>
                                                <li>ProcessWire, Craft CMS</li>
                                            </ul>
                                        </div>
                                        <div class="col-md-6">
                                            <h5>E-commerce & Builders</h5>
                                            <ul>
                                                <li>Magento, Shopify, WooCommerce</li>
                                                <li>Wix, Squarespace, Webflow</li>
                                                <li>Static generators (Jekyll, Hugo)</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/@tabler/core@1.0.0-beta20/dist/js/tabler.min.js"></script>
    <script>
        let uploadedFileName = '';
        let checkJobId = '';
        let resultsData = []; // Store results for data table

        // Navigation functions
        function showPage(pageName) {
            // Hide all pages
            document.querySelectorAll('.page-section').forEach(page => {
                page.classList.remove('active');
            });
            
            // Show selected page
            document.getElementById(pageName + '-page').classList.add('active');
            
            // Update navigation active state
            document.querySelectorAll('.nav-link').forEach(link => {
                link.classList.remove('active');
            });
            
            // Find and activate the correct nav link
            const navLinks = document.querySelectorAll('.nav-link');
            navLinks.forEach(link => {
                if (link.getAttribute('onclick') && link.getAttribute('onclick').includes(pageName)) {
                    link.classList.add('active');
                }
            });
        }

        // File upload handling
        const uploadSection = document.getElementById('uploadSection');
        const fileInput = document.getElementById('fileInput');
        const fileInfo = document.getElementById('fileInfo');
        const checkBtn = document.getElementById('checkBtn');
        const alerts = document.getElementById('alerts');

        function showAlert(message, type = 'error') {
            const alert = document.createElement('div');
            alert.className = \`alert alert-\${type === 'error' ? 'danger' : type}\`;
            alert.textContent = message;
            alerts.appendChild(alert);
            setTimeout(() => alert.remove(), 5000);
        }

        // Data table functions
        let currentSort = { column: null, direction: 'asc' };
        let sortedResultsData = [];

        function updateResultsTable() {
            const tbody = document.getElementById('resultsTableBody');
            const exportBtn = document.getElementById('exportBtn');
            
            if (resultsData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No results yet. Start a scan to see detected Umbraco sites.</td></tr>';
                exportBtn.style.display = 'none';
                return;
            }
            
            // Use sorted data if available, otherwise use original data
            const dataToDisplay = sortedResultsData.length > 0 ? sortedResultsData : resultsData;
            
            tbody.innerHTML = '';
            dataToDisplay.forEach((result, index) => {
                const row = document.createElement('tr');
                row.innerHTML = \`
                    <td>\${index + 1}</td>
                    <td><strong>\${result.domain}</strong></td>
                    <td>\${result.companyName || 'N/A'}</td>
                    <td><span class="badge bg-success">Yes</span></td>
                    <td><span class="badge score-badge bg-primary">\${result.score}</span></td>
                    <td><span class="badge confidence-badge bg-\${result.confidence === 'high' ? 'success' : result.confidence === 'medium' ? 'warning' : 'info'}">\${result.confidence}</span></td>
                    <td><small class="text-muted">\${result.reason}</small></td>
                \`;
                tbody.appendChild(row);
            });
            
            exportBtn.style.display = 'inline-block';
        }

        function sortTable(column) {
            // Determine sort direction
            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                currentSort.direction = 'asc';
            }

            // Create a copy of the data for sorting
            sortedResultsData = [...resultsData];

            // Sort based on column
            sortedResultsData.sort((a, b) => {
                let aVal, bVal;
                
                switch (column) {
                    case 'domain':
                        aVal = a.domain.toLowerCase();
                        bVal = b.domain.toLowerCase();
                        break;
                    case 'umbraco':
                        // Group Umbraco results (all are "Yes" so this is mainly for consistency)
                        aVal = 'Yes';
                        bVal = 'Yes';
                        break;
                    case 'score':
                        aVal = parseInt(a.score);
                        bVal = parseInt(b.score);
                        break;
                    case 'confidence':
                        // Sort by confidence level: high > medium > low
                        const confidenceOrder = { 'high': 3, 'medium': 2, 'low': 1 };
                        aVal = confidenceOrder[a.confidence] || 0;
                        bVal = confidenceOrder[b.confidence] || 0;
                        break;
                    default:
                        return 0;
                }

                // Compare values
                if (aVal < bVal) return currentSort.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return currentSort.direction === 'asc' ? 1 : -1;
                return 0;
            });

            // Update table headers with sort indicators
            updateSortHeaders();
            
            // Refresh the table
            updateResultsTable();
        }

        function updateSortHeaders() {
            // Remove all sort indicators
            document.querySelectorAll('.sort-indicator').forEach(indicator => {
                indicator.remove();
            });

            // Add sort indicator to current column
            if (currentSort.column) {
                const header = document.querySelector(\`th[onclick*="\${currentSort.column}"]\`);
                if (header) {
                    const indicator = document.createElement('span');
                    indicator.className = 'sort-indicator ms-1';
                    indicator.innerHTML = currentSort.direction === 'asc' ? '↑' : '↓';
                    header.appendChild(indicator);
                }
            }
        }

        function exportToCSV() {
            if (resultsData.length === 0) {
                showAlert('No results to export', 'warning');
                return;
            }
            
            const headers = ['Number', 'Domain Name', 'Company Name', 'Umbraco', 'Score', 'Confidence', 'Reason'];
            const csvContent = [
                headers.join(','),
                ...resultsData.map((result, index) => [
                    index + 1,
                    result.domain,
                    result.companyName || 'N/A',
                    'Yes',
                    result.score,
                    result.confidence,
                    \`"\${result.reason.replace(/"/g, '""')}"\`
                ].join(','))
            ].join('\\n');
            
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', 'bluedetect_umbraco_results.csv');
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            showAlert('Results exported successfully!', 'success');
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
                    document.getElementById('fileDetails').innerHTML = \`
                        <p><strong>\${file.name}</strong></p>
                        <p class="h2 text-primary">\${result.domainCount}</p>
                        <p>domains detected</p>
                    \`;
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

            try {
                const response = await fetch('/check', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        filename: uploadedFileName,
                        method: 'http'
                    })
                });

                const result = await response.json();

                if (response.ok) {
                    checkJobId = result.jobId;
                    document.getElementById('progressContainer').style.display = 'block';
                    document.getElementById('fileInfo').style.display = 'none';
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
                        document.getElementById('fileInfo').style.display = 'block';
                        document.getElementById('checkBtn').style.display = 'inline-block';
                        document.getElementById('stopBtn').style.display = 'none';
                        document.getElementById('progressContainer').style.display = 'none';
                        
                        if (progress.status === 'completed') {
                            showAlert(\`Checking completed! \${progress.successCount} Umbraco sites found.\`, 'success');
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
            const progressFill = document.getElementById('progressFill');
            const status = document.getElementById('status');
            const checkedCount = document.getElementById('checkedCount');
            const successCount = document.getElementById('successCount');

            const percentage = progress.total > 0 ? (progress.checked / progress.total) * 100 : 0;
            progressFill.style.width = percentage + '%';
            
            if (progress.currentDomain) {
                status.innerHTML = \`<div class="spinner-border spinner-border-sm me-2" role="status"></div>Checking: \${progress.currentDomain}\`;
            } else {
                status.textContent = progress.status === 'completed' ? 'Checking completed!' : 
                                   progress.status === 'stopped' ? 'Checking stopped.' : 'Processing...';
            }

            checkedCount.textContent = progress.checked;
            successCount.textContent = progress.successCount;

            // Update results data table
            if (progress.successfulDomainsWithEvidence && progress.successfulDomainsWithEvidence.length > 0) {
                resultsData = progress.successfulDomainsWithEvidence.map(item => {
                    // Extract score and confidence from evidence
                    const scoreMatch = item.evidence[0]?.match(/Score: (\\d+)/);
                    const confidenceMatch = item.evidence[0]?.match(/Confidence: (\\w+)/);
                    const score = scoreMatch ? parseInt(scoreMatch[1]) : 0;
                    const confidence = confidenceMatch ? confidenceMatch[1] : 'low';
                    const reason = item.evidence.slice(1).join('; ') || 'Umbraco detected';
                    
                    return {
                        domain: item.domain,
                        companyName: null, // Could be enhanced to extract from CSV
                        score: score,
                        confidence: confidence,
                        reason: reason
                    };
                });
                updateResultsTable();
            }

            // Show results page when scan completes
            if (progress.status === 'completed' && progress.successCount > 0) {
                showPage('results');
            }
        }

        // Initialize results table on page load
        updateResultsTable();
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
        successfulDomainsWithEvidence: [], // Store domains with their evidence
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

  // Generate CSV with evidence
  const csvData = [['Domain', 'Evidence']];
  progress.successfulDomainsWithEvidence.forEach(item => {
    csvData.push([item.domain, item.evidence.join('; ')]);
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
            evidence: results.evidence
          });
          progress.successCount++;
          console.log(`✓ ${domain} - Umbraco detected! Evidence: ${results.evidence.join('; ')}`);
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
    
    // Try HTTPS first
    try {
      const httpsResult = await makeHTTPRequest(`https://${domain}/umbraco/`, true);
      if (httpsResult.success) {
        isUmbraco = httpsResult.isUmbraco;
        evidence = httpsResult.evidence;
        if (isUmbraco) {
          return resolve({ isUmbraco, evidence });
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
      }
    } catch (error) {
      console.log(`🔄 ${domain} - HTTP also failed: ${error.message}`);
    }

    resolve({ isUmbraco, evidence });
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
          resolve({
            success: true,
            isUmbraco: isUmbraco.isUmbraco,
            evidence: isUmbraco.evidence
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

// Analyze response for Umbraco indicators using weighted scoring system
function analyzeResponseForUmbraco(content, headers, statusCode, url) {
  let evidence = [];
  let score = 0;
  let confidence = 'low';
  
  // Check status code
  if (statusCode !== 200) {
    return { isUmbraco: false, evidence: ['Status code: ' + statusCode] };
  }

  // EXCLUSION CHECK: Meta generator tag analysis
  const metaGeneratorMatch = content.match(/<meta\s+name=['"]generator['"]\s+content=['"]([^'"]+)['"]/i);
  if (metaGeneratorMatch) {
    const generator = metaGeneratorMatch[1].toLowerCase();
    
    // List of non-Umbraco CMS generators
    const nonUmbracoGenerators = [
      // Traditional CMS
      'wordpress', 'drupal', 'joomla', 'typo3', 'modx', 'concrete5', 'textpattern', 
      'processwire', 'craft cms', 'expressionengine',
      // E-commerce CMS
      'magento', 'opencart', 'prestashop', 'woocommerce', 'shopify', 'bigcommerce',
      // Static Site Generators
      'jekyll', 'hugo', 'gatsby', 'next.js', 'nuxt.js', 'hexo', 'pelican', 'middleman',
      // Website Builders
      'wix.com', 'squarespace', 'weebly', 'webflow',
      // Wiki & Documentation
      'mediawiki', 'dokuwiki', 'tiddlywiki', 'gitiles',
      // Blogging Platforms
      'ghost', 'blogger', 'tumblr',
      // Enterprise CMS
      'sitecore', 'adobe experience manager', 'episerver', 'optimizely', 'kentico',
      // Headless/API-first CMS
      'contentful', 'strapi', 'sanity',
      // Forum/Community Software
      'phpbb', 'vbulletin', 'xenforo', 'discourse'
    ];
    
    const isNonUmbraco = nonUmbracoGenerators.some(nonUmbraco => 
      generator.includes(nonUmbraco)
    );
    
    if (isNonUmbraco) {
      return { 
        isUmbraco: false, 
        evidence: [`EXCLUDED: Meta generator indicates non-Umbraco CMS: ${metaGeneratorMatch[1]}`] 
      };
    }
  }

  // PRIMARY INDICATORS (High Confidence - 3 points each)
  
  // 1. Admin Path Detection - /umbraco/ path accessibility
  if (url.includes('/umbraco/') || url.includes('/umbraco')) {
    score += 3;
    evidence.push('PRIMARY: Admin path /umbraco/ detected');
  }
  
  // 2. Umbraco-specific file paths
  const umbracoPaths = [
    '/App_Plugins/',
    '/umbraco_client/',
    '/Views/',
    '/umbraco/umbraco.aspx',
    '/umbraco/login.aspx',
    '/umbraco/dashboard.aspx'
  ];
  
  const foundPaths = umbracoPaths.filter(path => 
    url.includes(path) || content.includes(path)
  );
  
  if (foundPaths.length > 0) {
    score += 3;
    evidence.push(`PRIMARY: Umbraco file paths detected: ${foundPaths.join(', ')}`);
  }

  // SECONDARY INDICATORS (Medium Confidence - 2 points each)
  
  // 3. ASP.NET/IIS server signatures
  const aspNetHeaders = [
    'x-aspnet-version',
    'x-aspnetmvc-version',
    'x-powered-by'
  ];
  
  const foundAspNetHeaders = aspNetHeaders.filter(header => 
    headers[header] || Object.keys(headers).some(key => 
      key.toLowerCase().includes(header.toLowerCase())
    )
  );
  
  if (foundAspNetHeaders.length > 0) {
    score += 2;
    evidence.push(`SECONDARY: ASP.NET/IIS headers detected: ${foundAspNetHeaders.join(', ')}`);
  }
  
  // 4. Umbraco-specific directory structures in content
  const umbracoDirs = [
    'App_Plugins',
    'umbraco_client',
    'umbraco/Views',
    'umbraco/App_Plugins',
    'umbraco/umbraco'
  ];
  
  const foundDirs = umbracoDirs.filter(dir => 
    content.includes(dir) || content.includes(`/${dir}/`)
  );
  
  if (foundDirs.length > 0) {
    score += 2;
    evidence.push(`SECONDARY: Umbraco directory structures: ${foundDirs.join(', ')}`);
  }
  
  // 5. Client Dependency Framework patterns
  const cdfPatterns = [
    'umbraco.clientdependency',
    'umbraco_client',
    'ClientDependency',
    'umbraco.css',
    'umbraco.js'
  ];
  
  const foundCdfPatterns = cdfPatterns.filter(pattern => 
    content.toLowerCase().includes(pattern.toLowerCase())
  );
  
  if (foundCdfPatterns.length > 0) {
    score += 2;
    evidence.push(`SECONDARY: Client Dependency Framework patterns: ${foundCdfPatterns.join(', ')}`);
  }

  // TERTIARY INDICATORS (Low Confidence - 1 point each)
  
  // 6. Generic .NET application patterns
  if (content.includes('.aspx') || url.includes('.aspx')) {
    score += 1;
    evidence.push('TERTIARY: ASPX extensions detected (.NET application)');
  }
  
  // 7. Umbraco-specific CSS classes and HTML elements
  const umbracoElements = [
    'class="umbraco',
    'id="umbraco',
    '<umbraco',
    'umbraco-login',
    'umbraco-dashboard',
    'umbraco-content'
  ];
  
  const foundElements = umbracoElements.filter(element => 
    content.includes(element)
  );
  
  if (foundElements.length > 0) {
    score += 1;
    evidence.push(`TERTIARY: Umbraco HTML elements: ${foundElements.join(', ')}`);
  }
  
  // 8. Umbraco-specific JavaScript references
  const umbracoJs = [
    'umbraco.js',
    'umbraco.min.js',
    'umbraco_client',
    'umbraco/scripts'
  ];
  
  const foundJs = umbracoJs.filter(js => 
    content.toLowerCase().includes(js.toLowerCase())
  );
  
  if (foundJs.length > 0) {
    score += 1;
    evidence.push(`TERTIARY: Umbraco JavaScript references: ${foundJs.join(', ')}`);
  }
  
  // 9. Umbraco-specific text patterns
  const umbracoTextPatterns = [
    'umbraco',
    'Umbraco',
    'UMBRACO',
    'umbraco.aspx',
    'umbraco-login',
    'umbraco-dashboard'
  ];
  
  const foundTextPatterns = umbracoTextPatterns.filter(pattern => 
    content.toLowerCase().includes(pattern.toLowerCase())
  );
  
  if (foundTextPatterns.length > 0) {
    score += 1;
    evidence.push(`TERTIARY: Umbraco text patterns: ${foundTextPatterns.join(', ')}`);
  }

  // Determine confidence level and final result
  if (score >= 6) {
    confidence = 'high';
  } else if (score >= 3) {
    confidence = 'medium';
  }
  
  // Require minimum score for Umbraco detection
  const isUmbraco = score >= 3;
  
  if (isUmbraco) {
    evidence.unshift(`Umbraco detected (Score: ${score}, Confidence: ${confidence})`);
  } else {
    evidence.unshift(`Not Umbraco (Score: ${score}, need 3+ points)`);
  }

  return { isUmbraco, evidence };
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
  console.log(`🚀 BlueDetect - Umbraco CMS Detector running on http://localhost:${PORT}`);
  console.log('📁 Upload a CSV file with domain names to get started!');
});
