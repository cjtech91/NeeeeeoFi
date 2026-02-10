const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const projectRoot = path.join(__dirname, '../../');
const backupDir = path.join(projectRoot, 'backups');

// Ensure backup directory exists
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = path.join(backupDir, `pisowifi-backup-${timestamp}.tar.gz`);

console.log(`📦 Creating backup of project...`);
console.log(`📂 Source: ${projectRoot}`);
console.log(`💾 Destination: ${backupFile}`);

// Exclude list
const excludes = [
    'node_modules',
    '.git',
    'backups',
    '*.sqlite', // Optional: exclude DB if it's large, but maybe user wants it? 
                // Usually for "build" backup we exclude data. 
                // Let's keep it simple and exclude large generated folders.
    '*.log',
    '.DS_Store'
];

const excludeParams = excludes.map(e => `--exclude="${e}"`).join(' ');

// Use tar to create archive
const cmd = `tar -czf "${backupFile}" ${excludeParams} -C "${projectRoot}" .`;

exec(cmd, (error, stdout, stderr) => {
    if (error) {
        console.error(`❌ Backup failed: ${error.message}`);
        return;
    }
    if (stderr) {
        // tar sends verbose output to stderr sometimes, but check if it's actual error
        // console.warn(`⚠️  Tar Output: ${stderr}`);
    }
    console.log(`✅ Backup created successfully!`);
    console.log(`📍 Path: ${backupFile}`);
});
