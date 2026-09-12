/**
 * Google Drive Service Helper
 * Manages Google Drive file & folder link extraction, preview links, download links,
 * and direct Google Drive API / Google Apps Script uploads.
 */

const fs = require('fs');

function extractDriveId(urlOrId) {
  if (!urlOrId) return null;
  const str = String(urlOrId).trim();
  
  if (str.length === 33 || (str.length >= 25 && !str.includes('/') && !str.includes('.'))) {
    return { id: str, isFolder: false };
  }
  
  // Match folder URLs: /folders/ID
  const matchFolders = str.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (matchFolders && matchFolders[1]) {
    return { id: matchFolders[1], isFolder: true };
  }

  // Match file URLs: /file/d/ID, id=ID
  const matchFile = str.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (matchFile && matchFile[1]) {
    return { id: matchFile[1], isFolder: false };
  }
  
  const matchId = str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (matchId && matchId[1]) {
    return { id: matchId[1], isFolder: false };
  }

  return null;
}

function formatDriveUrls(driveInput, originalFileName, localFileRelativePath) {
  const extracted = extractDriveId(driveInput);
  
  if (extracted) {
    if (extracted.isFolder) {
      return {
        driveId: extracted.id,
        isFolder: true,
        driveViewUrl: `https://drive.google.com/drive/folders/${extracted.id}`,
        driveDownloadUrl: localFileRelativePath || `https://drive.google.com/drive/folders/${extracted.id}`,
        driveEmbedUrl: localFileRelativePath || `https://drive.google.com/drive/folders/${extracted.id}`
      };
    } else {
      return {
        driveId: extracted.id,
        isFolder: false,
        driveViewUrl: `https://drive.google.com/file/d/${extracted.id}/view?usp=sharing`,
        driveDownloadUrl: `https://drive.google.com/uc?export=download&id=${extracted.id}`,
        driveEmbedUrl: `https://drive.google.com/file/d/${extracted.id}/preview`
      };
    }
  }

  // Fallback if local file uploaded
  if (localFileRelativePath) {
    return {
      driveId: 'local_' + Date.now(),
      isFolder: false,
      driveViewUrl: localFileRelativePath,
      driveDownloadUrl: localFileRelativePath,
      driveEmbedUrl: localFileRelativePath
    };
  }

  const randomId = '1drive_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now().toString(36);
  return {
    driveId: randomId,
    isFolder: false,
    driveViewUrl: driveInput.startsWith('http') ? driveInput : `https://drive.google.com/file/d/${randomId}/view?usp=sharing`,
    driveDownloadUrl: driveInput.startsWith('http') ? driveInput : `https://drive.google.com/uc?export=download&id=${randomId}`,
    driveEmbedUrl: driveInput.startsWith('http') ? driveInput : `https://drive.google.com/file/d/${randomId}/preview`
  };
}

/**
 * Upload file directly to Google Drive via Google Apps Script Web App endpoint.
 * Handles 302/301 redirects from script.google.com by re-posting payload to location URL.
 */
async function uploadToGoogleDriveViaScript(localFilePath, fileName, folderId, gasDeploymentUrl) {
  if (!gasDeploymentUrl || !fs.existsSync(localFilePath)) {
    return null;
  }

  try {
    const fileBuffer = fs.readFileSync(localFilePath);
    const fileBase64 = fileBuffer.toString('base64');
    
    let mimeType = 'application/octet-stream';
    if (fileName.endsWith('.pdf')) mimeType = 'application/pdf';
    else if (fileName.endsWith('.docx')) mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    else if (fileName.endsWith('.doc')) mimeType = 'application/msword';
    else if (fileName.endsWith('.xlsx')) mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    else if (fileName.endsWith('.pptx')) mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    else if (fileName.endsWith('.png')) mimeType = 'image/png';
    else if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) mimeType = 'image/jpeg';

    const payload = JSON.stringify({
      folderId: folderId,
      fileName: fileName,
      fileBase64: fileBase64,
      mimeType: mimeType
    });

    // Step 1: Initial POST request with manual redirect handling
    let response = await fetch(gasDeploymentUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      redirect: 'manual'
    });

    // Step 2: Handle 302/301/307 Redirects from Google Apps Script
    if (response.status === 302 || response.status === 301 || response.status === 307) {
      const redirectUrl = response.headers.get('location');
      if (redirectUrl) {
        response = await fetch(redirectUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          redirect: 'follow'
        });
      }
    }

    const resText = await response.text();
    let data;
    try {
      data = JSON.parse(resText);
    } catch (parseErr) {
      console.error('GAS response is not JSON:', resText.substring(0, 300));
      return null;
    }

    if (data && data.success && data.fileId) {
      return {
        fileId: data.fileId,
        driveViewUrl: data.driveViewUrl || `https://drive.google.com/file/d/${data.fileId}/view?usp=sharing`,
        driveDownloadUrl: data.driveDownloadUrl || `https://drive.google.com/uc?export=download&id=${data.fileId}`,
        driveEmbedUrl: `https://drive.google.com/file/d/${data.fileId}/preview`
      };
    } else if (data && data.error) {
      console.error('GAS Returned Error:', data.error);
    }
  } catch (err) {
    console.error('Google Apps Script Upload Exception:', err.message);
  }
  return null;
}

module.exports = {
  extractDriveId,
  formatDriveUrls,
  uploadToGoogleDriveViaScript
};
