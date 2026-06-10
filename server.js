/**
 * 成长相册排版软件 - 本地服务器
 * 启动方式: node server.js
 * 然后浏览器打开 http://localhost:3456
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 0; // 0 = 让系统自动分配可用端口
const ROOT = __dirname;

// MIME 类型
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  // API 路由
  if (url.pathname === '/api/scan') {
    handleScan(url, res);
    return;
  }
  if (url.pathname === '/api/thumbnail') {
    handleThumbnail(url, res);
    return;
  }
  if (url.pathname === '/api/full-image') {
    handleFullImage(url, res);
    return;
  }
  if (url.pathname === '/api/dir-select') {
    handleDirSelect(res);
    return;
  }
  
  // 静态文件
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.join(ROOT, filePath);
  
  // 安全检查：不允许访问根目录以外的文件
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  
  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';
  
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// 扫描目录（智能识别目录层级）
function handleScan(url, res) {
  const dirPath = url.searchParams.get('path');
  if (!dirPath) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'Missing path' }));
    return;
  }
  
  const result = {};
  
  // 从文件名中提取日期（支持 YYYYMMDD_HHMMSS、YYYY-MM-DD 等格式）
  function extractDateFromName(name) {
    const patterns = [
      { re: /(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/, groups: [1, 2] },  // 20070725_161530
      { re: /(\d{4})-(\d{2})-(\d{2})/, groups: [1, 2] },                             // 2007-07-25
      { re: /(\d{4})(\d{2})(\d{2})/, groups: [1, 2] },                               // 20070725
      { re: /IMG[_-](\d{4})(\d{2})(\d{2})/, groups: [1, 2] },                        // IMG_20070725
      { re: /VID[_-](\d{4})(\d{2})(\d{2})/, groups: [1, 2] },                        // VID_20070725
    ];
    for (const p of patterns) {
      const m = name.match(p.re);
      if (m) {
        const year = m[p.groups[0]];
        const month = m[p.groups[1]];
        // 验证合理性
        const y = parseInt(year);
        const mon = parseInt(month);
        if (y >= 1900 && y <= 2030 && mon >= 1 && mon <= 12) {
          return { year: year, month: year + month };
        }
      }
    }
    return null;
  }
  
  // 从目录名提取年份
  function extractYearFromDirName(name) {
    const m = name.match(/^(\d{4})/);
    if (m) {
      const y = parseInt(m[1]);
      if (y >= 1900 && y <= 2030) return m[1];
    }
    return null;
  }
  
  // 递归扫描
  function scanDir(currentPath, inheritedYear) {
    let dirPhotos = [];
    let subDirs = [];
    
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        
        if (entry.isDirectory()) {
          // 跳过系统目录
          if (entry.name.startsWith('$') || entry.name === 'System Volume Information') continue;
          
          // 尝试从目录名提取年份
          const dirYear = extractYearFromDirName(entry.name) || inheritedYear;
          subDirs.push({ name: entry.name, path: fullPath, year: dirYear });
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'].includes(ext)) {
            const stat = fs.statSync(fullPath);
            dirPhotos.push({
              name: entry.name,
              path: fullPath,
              size: stat.size,
              mtime: stat.mtime.toISOString()
            });
          }
        }
      }
    } catch (e) {
      // 跳过无权限的目录
    }
    
    // 为当前目录的照片确定年份和月份
    if (dirPhotos.length > 0) {
      for (const photo of dirPhotos) {
        let year = null;
        let monthKey = null;
        
        // 1. 优先从文件名提取日期
        const nameDate = extractDateFromName(photo.name);
        if (nameDate) {
          year = nameDate.year;
          monthKey = nameDate.month;
        }
        
        // 2. 其次从继承的年份（目录名）
        if (!year && inheritedYear) {
          year = inheritedYear;
        }
        
        // 3. 最后从文件修改时间
        if (!year) {
          const mtimeDate = new Date(photo.mtime);
          year = mtimeDate.getFullYear().toString();
          monthKey = year + String(mtimeDate.getMonth() + 1).padStart(2, '0');
        }
        
        // 如果没有 monthKey（只有 inheritedYear 的情况），用 mtime 的月份
        if (!monthKey) {
          const mtimeDate = new Date(photo.mtime);
          monthKey = year + String(mtimeDate.getMonth() + 1).padStart(2, '0');
        }
        
        photo.yearFolder = year;
        photo.monthFolder = monthKey;
        
        const yf = photo.yearFolder;
        const mf = photo.monthFolder;
        
        if (!result[yf]) result[yf] = [];
        
        let monthGroup = result[yf].find(g => g.monthFolder === mf);
        if (!monthGroup) {
          monthGroup = { yearFolder: yf, monthFolder: mf, photos: [] };
          result[yf].push(monthGroup);
        }
        monthGroup.photos.push(photo);
      }
    }
    
    // 递归扫描子目录
    for (const sub of subDirs) {
      scanDir(sub.path, sub.year);
    }
  }
  
  try {
    scanDir(dirPath, null);
    
    // 排序
    for (const key of Object.keys(result)) {
      result[key].sort((a, b) => a.monthFolder.localeCompare(b.monthFolder));
      for (const group of result[key]) {
        group.photos.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
      }
    }
    
    // 合并同一年中相同 monthFolder 的重复分组
    for (const key of Object.keys(result)) {
      const merged = new Map();
      for (const group of result[key]) {
        if (merged.has(group.monthFolder)) {
          merged.get(group.monthFolder).photos.push(...group.photos);
        } else {
          merged.set(group.monthFolder, group);
        }
      }
      result[key] = [...merged.values()];
      result[key].sort((a, b) => a.monthFolder.localeCompare(b.monthFolder));
      for (const group of result[key]) {
        group.photos.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
      }
    }
    
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
  } catch (e) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message }));
  }
}

// 缩略图（需要 sharp，没有则返回原图路径让浏览器缩放）
function handleThumbnail(url, res) {
  const filePath = url.searchParams.get('path');
  if (!filePath) {
    res.writeHead(400);
    res.end('Missing path');
    return;
  }
  
  // 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  
  // 尝试使用 sharp 生成缩略图
  try {
    const sharp = require('sharp');
    sharp(filePath)
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer()
      .then(buffer => {
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=3600' });
        res.end(buffer);
      })
      .catch(() => {
        sendOriginal(res, filePath);
      });
  } catch (e) {
    // sharp 未安装，直接发送原图
    sendOriginal(res, filePath);
  }
}

function sendOriginal(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'image/jpeg';
  const stream = fs.createReadStream(filePath);
  res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'max-age=3600' });
  stream.pipe(res);
}

// 获取原图
function handleFullImage(url, res) {
  const filePath = url.searchParams.get('path');
  if (!filePath || !fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'image/jpeg';
  const stream = fs.createReadStream(filePath);
  res.writeHead(200, { 'Content-Type': mime });
  stream.pipe(res);
}

// 目录选择对话框（使用 PowerShell + 自定义树形对话框，支持完整浏览）
function handleDirSelect(res) {
  const psFile = path.join(__dirname, '_select_dir.ps1');
  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "选择照片文件夹"
$form.Size = New-Object System.Drawing.Size(650, 520)
$form.StartPosition = "CenterScreen"
$form.MinimizeBox = $false
$form.MaximizeBox = $false
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.TopMost = $true

# 说明标签
$label = New-Object System.Windows.Forms.Label
$label.Text = "浏览并选择包含照片的文件夹，然后点击确定："
$label.Location = New-Object System.Drawing.Point(15, 15)
$label.Size = New-Object System.Drawing.Size(580, 22)
$label.Font = New-Object System.Drawing.Font("Microsoft YaHei", 10)
$form.Controls.Add($label)

# 当前路径显示
$pathBox = New-Object System.Windows.Forms.TextBox
$pathBox.Location = New-Object System.Drawing.Point(15, 42)
$pathBox.Size = New-Object System.Drawing.Size(530, 24)
$pathBox.Font = New-Object System.Drawing.Font("Microsoft YaHei", 9)
$pathBox.ReadOnly = $true
$pathBox.BackColor = [System.Drawing.Color]::White
$form.Controls.Add($pathBox)

# 树形控件
$tree = New-Object System.Windows.Forms.TreeView
$tree.Location = New-Object System.Drawing.Point(15, 75)
$tree.Size = New-Object System.Drawing.Size(605, 360)
$tree.Font = New-Object System.Drawing.Font("Microsoft YaHei", 9)
$tree.ShowLines = $true
$tree.ShowPlusMinus = $true
$tree.HideSelection = $false
$form.Controls.Add($tree)

# 加载所有磁盘根目录
function LoadDrives {
  $tree.Nodes.Clear()
  $drives = Get-PSDrive -PSProvider FileSystem | Where-Object { Test-Path $_.Root }
  foreach ($drive in $drives) {
    $label = $drive.Root
    try {
      $vol = Get-Volume -DriveLetter $drive.Name -ErrorAction SilentlyContinue
      if ($vol.FileSystemLabel) { $label = "$($vol.FileSystemLabel) ($($drive.Name):)" }
    } catch {}
    $node = $tree.Nodes.Add($label)
    $node.Tag = $drive.Root
    $node.Nodes.Add("") | Out-Null  # 占位，用于显示展开按钮
  }
}

# 展开时加载子目录
$tree.Add_BeforeExpand({
  $node = $_.Node
  if ($node.Nodes.Count -eq 1 -and $node.Nodes[0].Text -eq "") {
    $node.Nodes.Clear()
    try {
      $items = Get-ChildItem -LiteralPath $node.Tag -Directory -ErrorAction Stop |
        Sort-Object Name | Select-Object -First 200
      foreach ($item in $items) {
        $child = $node.Nodes.Add($item.Name)
        $child.Tag = $item.FullName
        try {
          $hasSub = [bool](Get-ChildItem -LiteralPath $item.FullName -Directory -ErrorAction Stop | Select-Object -First 1)
          if ($hasSub) { $child.Nodes.Add("") | Out-Null }
        } catch {}
      }
    } catch {}
  }
})

# 选中节点时更新路径框
$tree.AfterSelect({
  if ($tree.SelectedNode) {
    $pathBox.Text = $tree.SelectedNode.Tag
  }
})

# 确定按钮
$btnOk = New-Object System.Windows.Forms.Button
$btnOk.Text = "确定"
$btnOk.Location = New-Object System.Drawing.Point(440, 445)
$btnOk.Size = New-Object System.Drawing.Size(85, 30)
$btnOk.Font = New-Object System.Drawing.Font("Microsoft YaHei", 9)
$btnOk.Add_Click({
  if ($tree.SelectedNode) {
    $form.Tag = $tree.SelectedNode.Tag
    $form.Close()
  } else {
    [System.Windows.Forms.MessageBox]::Show("请先选择一个文件夹", "提示", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
  }
})
$form.Controls.Add($btnOk)

# 取消按钮
$btnCancel = New-Object System.Windows.Forms.Button
$btnCancel.Text = "取消"
$btnCancel.Location = New-Object System.Drawing.Point(535, 445)
$btnCancel.Size = New-Object System.Drawing.Size(85, 30)
$btnCancel.Font = New-Object System.Drawing.Font("Microsoft YaHei", 9)
$btnCancel.Add_Click({ $form.Close() })
$form.Controls.Add($btnCancel)

# 新建文件夹按钮
$btnNew = New-Object System.Windows.Forms.Button
$btnNew.Text = "新建文件夹"
$btnNew.Location = New-Object System.Drawing.Point(15, 445)
$btnNew.Size = New-Object System.Drawing.Size(90, 30)
$btnNew.Font = New-Object System.Drawing.Font("Microsoft YaHei", 9)
$btnNew.Add_Click({
  if ($tree.SelectedNode) {
    $parentPath = $tree.SelectedNode.Tag
    $dlg = New-Object System.Windows.Forms.Form
    $dlg.Text = "新建文件夹"
    $dlg.Size = New-Object System.Drawing.Size(360, 140)
    $dlg.StartPosition = "CenterParent"
    $dlg.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    $dlg.MaximizeBox = $false
    $dlg.MinimizeBox = $false
    $txt = New-Object System.Windows.Forms.TextBox
    $txt.Location = New-Object System.Drawing.Point(15, 15)
    $txt.Size = New-Object System.Drawing.Size(315, 24)
    $txt.Font = New-Object System.Drawing.Font("Microsoft YaHei", 9)
    $dlg.Controls.Add($txt)
    $ok = New-Object System.Windows.Forms.Button
    $ok.Text = "确定"
    $ok.Location = New-Object System.Drawing.Point(170, 55)
    $ok.Size = New-Object System.Drawing.Size(70, 28)
    $ok.Add_Click({
      if ($txt.Text -ne "") {
        $newPath = Join-Path $parentPath $txt.Text
        try {
          New-Item -ItemType Directory -Path $newPath -Force | Out-Null
          $child = $tree.SelectedNode.Nodes.Add($txt.Text)
          $child.Tag = $newPath
          $tree.SelectedNode.Expand()
          $tree.SelectedNode = $child
          $pathBox.Text = $newPath
          $dlg.Close()
        } catch {
          [System.Windows.Forms.MessageBox]::Show("创建失败：$_", "错误", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
        }
      }
    })
    $dlg.Controls.Add($ok)
    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = "取消"
    $cancel.Location = New-Object System.Drawing.Point(250, 55)
    $cancel.Size = New-Object System.Drawing.Size(70, 28)
    $cancel.Add_Click({ $dlg.Close() })
    $dlg.Controls.Add($cancel)
    $dlg.ShowDialog($form) | Out-Null
  }
})
$form.Controls.Add($btnNew)

LoadDrives
$form.ShowDialog() | Out-Null
if ($form.Tag) {
  Write-Output $form.Tag
}
`;
  // 写入 UTF-8 BOM，解决中文乱码
  const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
  const content = Buffer.from(psScript, 'utf-8');
  fs.writeFileSync(psFile, Buffer.concat([bom, content]));

  exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`, { encoding: 'utf-8', timeout: 60000 }, (err, stdout) => {
    try { fs.unlinkSync(psFile); } catch {}
    if (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
    const dirPath = stdout.trim();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ path: dirPath || null }));
  });
}

server.listen(PORT, () => {
  const actualPort = server.address().port;
  const url = `http://localhost:${actualPort}`;
  
  console.log('');
  console.log('  📸 成长相册排版软件已启动！');
  console.log(`  🌐 请在浏览器中打开: ${url}`);
  console.log('');
  console.log('  使用说明：');
  console.log('  1. 点击"选择照片目录"选择照片根目录（如 D:\\）');
  console.log('  2. 浏览和精选照片（点击选中，双击大图预览）');
  console.log('  3. 点击"自动排版"生成相册');
  console.log('  4. 在排版视图中调整布局');
  console.log('  5. 导出为 PDF 或图片用于打印');
  console.log('');
  
  // 自动打开浏览器
  const startCmd = process.platform === 'win32' 
    ? `start ${url}`
    : process.platform === 'darwin'
    ? `open ${url}`
    : `xdg-open ${url}`;
  exec(startCmd);
});
