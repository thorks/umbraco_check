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
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }

        .container {
            max-width: 900px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
        }

        h1 {
            text-align: center;
            color: #333;
            margin-bottom: 10px;
            font-size: 2.5rem;
            font-weight: 700;
        }

        .subtitle {
            text-align: center;
            color: #666;
            margin-bottom: 30px;
            font-size: 1.1rem;
        }

        .upload-section {
            border: 3px dashed #667eea;
            border-radius: 15px;
            padding: 40px;
            text-align: center;
            margin-bottom: 30px;
            transition: all 0.3s ease;
            cursor: pointer;
        }

        .upload-section:hover {
            border-color: #764ba2;
            background: rgba(102, 126, 234, 0.05);
            transform: translateY(-2px);
        }

        .upload-section.dragover {
            border-color: #764ba2;
            background: rgba(102, 126, 234, 0.1);
            transform: scale(1.02);
        }

        #fileInput {
            display: none;
        }

        .upload-text {
            font-size: 1.2rem;
            color: #666;
            margin-bottom: 15px;
        }

        .btn {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            border: none;
            padding: 12px 30px;
            border-radius: 30px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-block;
        }

        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
        }

        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }

        .btn.secondary {
            background: linear-gradient(135deg, #28a745, #20c997);
        }

        .btn.danger {
            background: linear-gradient(135deg, #dc3545, #c82333);
        }

        .file-info {
            margin: 15px 0;
            padding: 20px;
            background: rgba(102, 126, 234, 0.1);
            border-radius: 15px;
            font-weight: 600;
            display: none;
        }

        .progress-container {
            display: none;
            margin: 30px 0;
            padding: 25px;
            background: rgba(255, 255, 255, 0.8);
            border-radius: 15px;
        }

        .progress-bar {
            width: 100%;
            height: 25px;
            background: #f0f0f0;
            border-radius: 15px;
            overflow: hidden;
            margin-bottom: 15px;
            box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .progress-fill {
            height: 100%;
            background: linear-gradient(135deg, #28a745, #20c997);
            width: 0%;
            transition: width 0.5s ease;
            border-radius: 15px;
        }

        .status {
            text-align: center;
            margin: 15px 0;
            font-weight: 600;
            font-size: 1.1rem;
        }

        .stats {
            display: flex;
            justify-content: space-around;
            margin: 20px 0;
            text-align: center;
        }

        .stat-item {
            padding: 15px;
            background: rgba(255, 255, 255, 0.7);
            border-radius: 10px;
            min-width: 120px;
        }

        .stat-number {
            font-size: 2rem;
            font-weight: bold;
            color: #333;
        }

        .stat-label {
            font-size: 0.9rem;
            color: #666;
            margin-top: 5px;
        }

        .results {
            margin-top: 30px;
            display: none;
        }

        .results h3 {
            color: #333;
            margin-bottom: 15px;
            font-size: 1.5rem;
        }

        .domain-list {
            max-height: 300px;
            overflow-y: auto;
            border: 1px solid #ddd;
            border-radius: 10px;
            padding: 20px;
            background: #f9f9f9;
            font-family: 'SF Mono', Consolas, monospace;
            font-size: 0.9rem;
        }

        .domain-item {
            padding: 12px 0;
            border-bottom: 1px solid #eee;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
        }

        .domain-item:last-child {
            border-bottom: none;
        }

        .domain-info {
            flex: 1;
            margin-right: 15px;
        }

        .domain-name {
            font-weight: 600;
            display: block;
            margin-bottom: 5px;
        }

        .domain-evidence {
            font-size: 0.8rem;
            color: #666;
            font-style: italic;
            line-height: 1.3;
        }

        .domain-status {
            font-size: 0.8rem;
            padding: 3px 8px;
            border-radius: 12px;
            background: #28a745;
            color: white;
            white-space: nowrap;
            flex-shrink: 0;
        }

        .controls {
            display: flex;
            gap: 15px;
            justify-content: center;
            margin: 20px 0;
            align-items: center;
        }

        .method-selector {
            display: flex;
            align-items: center;
            gap: 10px;
            background: rgba(255, 255, 255, 0.8);
            padding: 10px 15px;
            border-radius: 10px;
            border: 1px solid #ddd;
        }

        .method-selector label {
            font-weight: 600;
            color: #333;
            font-size: 0.9rem;
        }

        .method-selector select {
            padding: 5px 10px;
            border: 1px solid #ccc;
            border-radius: 5px;
            background: white;
            font-size: 0.9rem;
            cursor: pointer;
        }

        .alert {
            padding: 15px;
            border-radius: 10px;
            margin: 15px 0;
            font-weight: 600;
        }

        .alert.error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }

        .alert.success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }

        .loading-spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top-color: white;
            animation: spin 1s ease-in-out infinite;
            margin-right: 10px;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🌐 Umbraco CMS Detector</h1>
        <div class="subtitle">Advanced Umbraco detection with evidence analysis</div>
        
        <div class="upload-section" id="uploadSection">
            <div class="upload-text">📁 Drag & drop your CSV file here or click to browse<br><small>Note: Domains will be read from the 3rd column</small></div>
            <button class="btn" onclick="document.getElementById('fileInput').click()">Choose CSV File</button>
            <input type="file" id="fileInput" accept=".csv" />
        </div>

        <div id="fileInfo" class="file-info"></div>
        <div id="alerts"></div>

        <div class="controls">
            <div class="method-selector">
                <label for="checkMethod">Detection Method:</label>
                <select id="checkMethod">
                    <option value="http">🚀 Lightweight HTTP (Recommended)</option>
                </select>
            </div>
            <button id="checkBtn" class="btn" style="display: none;" onclick="startChecking()">
                🚀 Start Checking Domains
            </button>
            <button id="stopBtn" class="btn danger" style="display: none;" onclick="stopChecking()">
                ⏹️ Stop Checking
            </button>
        </div>

        <div class="progress-container" id="progressContainer">
            <div class="progress-bar">
                <div class="progress-fill" id="progressFill"></div>
            </div>
            <div class="status" id="status"></div>
            <div class="stats">
                <div class="stat-item">
                    <div class="stat-number" id="totalCount">0</div>
                    <div class="stat-label">Total</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number" id="checkedCount">0</div>
                    <div class="stat-label">Checked</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number" id="successCount">0</div>
                    <div class="stat-label">Success (200)</div>
                </div>
            </div>
        </div>

        <div class="results" id="results">
            <h3>✅ Umbraco CMS Detected</h3>
            <div class="domain-list" id="successList"></div>
            <div class="controls">
                <button class="btn secondary" id="downloadBtn" onclick="downloadResults()">
                    💾 Download Umbraco Results CSV
                </button>
            </div>
        </div>
    </div>

    <script>
        let uploadedFileName = '';
        let checkJobId = '';

        // File upload handling
        const uploadSection = document.getElementById('uploadSection');
        const fileInput = document.getElementById('fileInput');
        const fileInfo = document.getElementById('fileInfo');
        const checkBtn = document.getElementById('checkBtn');
        const alerts = document.getElementById('alerts');

        function showAlert(message, type = 'error') {
            const alert = document.createElement('div');
            alert.className = \`alert \${type}\`;
            alert.textContent = message;
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
                    fileInfo.innerHTML = \`📄 <strong>\${file.name}</strong> - \${result.domainCount} domains loaded\`;
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
            const progressFill = document.getElementById('progressFill');
            const status = document.getElementById('status');
            const checkedCount = document.getElementById('checkedCount');
            const successCount = document.getElementById('successCount');
            const successList = document.getElementById('successList');
            const results = document.getElementById('results');

            const percentage = progress.total > 0 ? (progress.checked / progress.total) * 100 : 0;
            progressFill.style.width = percentage + '%';
            
            if (progress.currentDomain) {
                status.innerHTML = \`<div class="loading-spinner"></div>Checking: \${progress.currentDomain}\`;
            } else {
                status.textContent = progress.status === 'completed' ? 'Checking completed!' : 
                                   progress.status === 'stopped' ? 'Checking stopped.' : 'Processing...';
            }

            checkedCount.textContent = progress.checked;
            successCount.textContent = progress.successCount;

            // Update successful domains list with evidence
            successList.innerHTML = '';
            if (progress.successfulDomainsWithEvidence && progress.successfulDomainsWithEvidence.length > 0) {
                progress.successfulDomainsWithEvidence.forEach(item => {
                    const domainItem = document.createElement('div');
                    domainItem.className = 'domain-item';
                    domainItem.innerHTML = \`
                        <div class="domain-info">
                            <span class="domain-name">\${item.domain}</span>
                            <div class="domain-evidence">\${item.evidence.join('; ')}</div>
                        </div>
                        <span class="domain-status">Umbraco ✓</span>
                    \`;
                    successList.appendChild(domainItem);
                });
            } else if (progress.successfulDomains && progress.successfulDomains.length > 0) {
                // Fallback for backward compatibility
                progress.successfulDomains.forEach(domain => {
                    const domainItem = document.createElement('div');
                    domainItem.className = 'domain-item';
                    domainItem.innerHTML = \`
                        <div class="domain-info">
                            <span class="domain-name">\${domain}</span>
                            <div class="domain-evidence">Evidence not available</div>
                        </div>
                        <span class="domain-status">200 OK</span>
                    \`;
                    successList.appendChild(domainItem);
                });
            }

            if (progress.successfulDomains.length > 0) {
                results.style.display = 'block';
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

// Analyze response for Umbraco indicators
function analyzeResponseForUmbraco(content, headers, statusCode, url) {
  let evidence = [];
  let matchCount = 0;
  
  // Check status code
  if (statusCode !== 200) {
    return { isUmbraco: false, evidence: ['Status code: ' + statusCode] };
  }

  // Method 1: Check for .aspx extensions (common in Umbraco)
  if (url.includes('.aspx') || content.includes('.aspx')) {
    matchCount++;
    evidence.push('Found .aspx extensions (common in Umbraco)');
  }
  
  // Method 2: Check for Umbraco-specific text patterns
  const umbracoPatterns = [
    'umbraco',
    'Umbraco',
    'UMBRACO',
    'umbraco.aspx',
    'umbraco/umbraco.aspx',
    'umbraco-login',
    'umbraco-dashboard'
  ];
  
  const foundPatterns = umbracoPatterns.filter(pattern => 
    content.toLowerCase().includes(pattern.toLowerCase())
  );
  
  if (foundPatterns.length > 0) {
    matchCount++;
    evidence.push(`Found Umbraco text patterns: ${foundPatterns.join(', ')}`);
  }
  
  // Method 3: Check response headers for Umbraco indicators
  const umbracoHeaders = Object.keys(headers).filter(key => 
    key.toLowerCase().includes('umbraco')
  );
  if (umbracoHeaders.length > 0) {
    matchCount++;
    evidence.push(`Found Umbraco headers: ${umbracoHeaders.join(', ')}`);
  }
  
  // Method 4: Check for Umbraco-specific HTML elements
  if (content.includes('<umbraco') || 
      content.includes('class="umbraco') || 
      content.includes('id="umbraco') ||
      content.includes('umbraco-login') ||
      content.includes('umbraco-dashboard')) {
    matchCount++;
    evidence.push('Found Umbraco-specific HTML elements');
  }
  
  // Method 5: Check for Umbraco admin interface elements
  if (content.includes('umbraco.aspx') || 
      content.includes('umbraco/umbraco.aspx') ||
      content.includes('umbraco-login') ||
      content.includes('umbraco-dashboard')) {
    matchCount++;
    evidence.push('Found Umbraco admin interface elements');
  }

  // Require at least 2 matches to confirm Umbraco
  const isUmbraco = matchCount >= 2;
  
  if (isUmbraco) {
    evidence.unshift(`Umbraco detected (${matchCount}/5 checks passed)`);
  } else {
    evidence.unshift(`Not Umbraco (${matchCount}/5 checks passed, need 2+)`);
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
  console.log(`🚀 Domain CSV Checker running on http://localhost:${PORT}`);
  console.log('📁 Upload a CSV file with domain names to get started!');
});
