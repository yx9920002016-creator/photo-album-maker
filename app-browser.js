// ==================== API 客户端 ====================
const API = {
  async scanPhotos(dirPath) {
    const resp = await fetch(`/api/scan?path=${encodeURIComponent(dirPath)}`);
    return resp.json();
  },
  thumbnailUrl(filePath) {
    return `/api/thumbnail?path=${encodeURIComponent(filePath)}`;
  },
  fullImageUrl(filePath) {
    return `/api/full-image?path=${encodeURIComponent(filePath)}`;
  },
  async selectDirectory() {
    const resp = await fetch('/api/dir-select');
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || '服务器返回错误 ' + resp.status);
    }
    const data = await resp.json();
    return data.path;
  }
};

// ==================== 全局状态 ====================
const state = {
  rootDir: null,
  photoData: {},
  selectedPhotos: new Map(),
  albumPages: [],
  currentView: 'select',
  currentYear: null,
  currentMonth: null,
  currentPhotos: [],
  lightboxIndex: -1,
  previewPage: 0,
  previewZoom: 70,
  theme: 'warm',
  albumTitle: '成长纪念册',
  albumSubtitle: '记录每一个美好瞬间',
  coverPhoto: null,
  frameStyle: 'clean',
  showDecorations: true,
  // 自由排版：当前选中的元素
  selectedElement: null,
  isDragging: false,
  dragOffset: { x: 0, y: 0 },
  isResizing: false,
  resizeHandle: null,
  isRotating: false,
  // 文字属性
  textPropsVisible: false,
};

// ==================== 照片智能评分系统 ====================
// 基于文件大小和文件名推测照片质量，给出 1-5 星评分
// 规则：文件越大通常质量越高，文件名包含特定关键词加分
const photoScoreCache = new Map();

function scorePhoto(photo) {
  if (photoScoreCache.has(photo.path)) return photoScoreCache.get(photo.path);
  let score = 3; // 基础分

  // 文件大小评分（越大越可能是高质量原图）
  const sizeMB = (photo.size || 0) / (1024 * 1024);
  if (sizeMB > 10) score += 2;
  else if (sizeMB > 5) score += 1;
  else if (sizeMB < 1) score -= 1;
  else if (sizeMB < 0.3) score -= 2;

  // 文件名关键词加分
  const name = (photo.name || '').toLowerCase();
  if (/best|精选|封面|cover|main/i.test(name)) score += 1;
  if (/blur|模糊|temp|临时|截图|screenshot/i.test(name)) score -= 2;
  if (/thumb|thumbnail|缩略图/i.test(name)) score -= 2;

  // 限制范围 1-5
  score = Math.max(1, Math.min(5, score));
  photoScoreCache.set(photo.path, score);
  return score;
}

function getScoreStars(score) {
  return '⭐'.repeat(score) + '☆'.repeat(5 - score);
}

function getScoreColor(score) {
  if (score >= 5) return '#f5a623';
  if (score >= 4) return '#7ed321';
  if (score >= 3) return '#4a90d9';
  if (score >= 2) return '#9b9b9b';
  return '#ccc';
}

let sortByScore = false;
function setSortMode(byScore) {
  sortByScore = byScore;
  const btn = $('#btn-sort-score');
  if (btn) {
    btn.textContent = byScore ? '⭐ 按时间排序' : '⭐ 按评分排序';
    btn.style.background = byScore ? 'var(--accent)' : '#f0f0f0';
    btn.style.color = byScore ? 'white' : 'var(--text)';
  }
  if (state.currentYear) renderPhotoGrid(state.currentYear, state.currentMonth);
}

// ==================== DOM 引用 ====================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ==================== 主题系统 ====================
function setTheme(themeName) {
  state.theme = themeName;
  const body = document.body;
  body.classList.remove('theme-girl', 'theme-boy', 'theme-vintage', 'theme-green');
  if (themeName !== 'warm') body.classList.add('theme-' + themeName);
  $$('.theme-dot').forEach(d => d.classList.remove('active'));
  const activeDot = $(`.theme-dot[data-theme="${themeName}"]`);
  if (activeDot) activeDot.classList.add('active');
  if (state.currentView === 'layout') renderAlbumPages();
  if (state.currentView === 'preview') renderPreview();
}
$$('.theme-dot').forEach(dot => {
  dot.addEventListener('click', () => setTheme(dot.dataset.theme));
});
setTheme('warm');

// ==================== 工具函数 ====================
function showToast(msg, duration = 2500) {
  const toast = $('#toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.add('hidden'), duration);
}
function showLoading(msg = '处理中...') {
  const el = $('#loading');
  $('#loading-text').textContent = msg;
  el.classList.remove('hidden');
}
function hideLoading() {
  $('#loading').classList.add('hidden');
}
function yearFolderLabel(yf) {
  if (!yf) return '未知';
  const m = yf.match(/^(\d{4})/);
  if (m) {
    const rest = yf.replace(m[1], '').replace(/[年_\-]/g, ' ').trim();
    return rest ? `${m[1]}年 ${rest}` : `${m[1]}年`;
  }
  return yf;
}
function monthFolderLabel(mf) {
  if (!mf) return '';
  const m = mf.match(/^(\d{4})(\d{2})/);
  if (m) return `${parseInt(m[2])}月`;
  return mf;
}
function escapePath(p) {
  return p.replace(/\\/g, '\\\\');
}

// ==================== 视图切换 ====================
function switchView(view) {
  state.currentView = view;
  $$('.view').forEach(v => v.classList.remove('active'));
  $(`#view-${view}`).classList.add('active');
  $$('.btn-tab').forEach(b => b.classList.remove('active'));
  $(`#btn-view-${view}`).classList.add('active');
  if (view === 'layout') renderAlbumPages();
  if (view === 'preview') renderPreview();
}
$$('.btn-tab').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// ==================== 照片扫描 ====================
async function loadDirectory(dir) {
  if (!dir) return;
  state.rootDir = dir;
  $('#dir-path').textContent = dir;
  $('#dir-input').value = dir;
  showLoading('正在扫描照片目录...');
  try {
    state.photoData = await API.scanPhotos(dir);
    renderYearNav();
    showToast(`扫描完成！共发现 ${countAllPhotos()} 张照片`);
  } catch (e) {
    showToast('扫描失败：' + e.message);
  }
  hideLoading();
}
$('#btn-select-dir').addEventListener('click', async () => {
  showLoading('正在打开目录选择对话框...');
  try {
    const dir = await API.selectDirectory();
    hideLoading();
    if (!dir) return;
    await loadDirectory(dir);
  } catch (e) {
    hideLoading();
    console.error('选择目录失败:', e);
    showToast('目录选择失败: ' + (e.message || '请检查服务器是否运行'));
  }
});
$('#btn-load-dir').addEventListener('click', async () => {
  const dir = $('#dir-input').value.trim();
  if (!dir) { showToast('请输入目录路径'); return; }
  await loadDirectory(dir);
});
$('#dir-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btn-load-dir').click();
});
$('#btn-quick-d').addEventListener('click', async () => {
  await loadDirectory('D:\\');
});
function countAllPhotos() {
  let count = 0;
  for (const months of Object.values(state.photoData)) {
    for (const m of months) count += m.photos.length;
  }
  return count;
}

// ==================== 年份导航 ====================
function renderYearNav() {
  const container = $('#year-list');
  container.innerHTML = '';
  const years = Object.keys(state.photoData).sort();
  years.forEach(yf => {
    const months = state.photoData[yf];
    const totalPhotos = months.reduce((s, m) => s + m.photos.length, 0);
    const yearDiv = document.createElement('div');
    yearDiv.className = 'year-item';
    yearDiv.innerHTML = `${yearFolderLabel(yf)} <span class="count">${totalPhotos}张</span>`;
    yearDiv.addEventListener('click', () => {
      const wasActive = yearDiv.classList.contains('active');
      container.querySelectorAll('.year-item').forEach(y => y.classList.remove('active'));
      container.querySelectorAll('.month-group').forEach(g => g.remove());
      if (!wasActive) {
        yearDiv.classList.add('active');
        state.currentYear = yf;
        state.currentMonth = null;
        renderMonthList(yf, yearDiv);
        renderPhotoGrid(yf, null);
      } else {
        state.currentYear = null;
        state.currentMonth = null;
        state.currentPhotos = [];
        renderPhotoGrid(null, null);
      }
    });
    container.appendChild(yearDiv);
  });
}
function renderMonthList(yearFolder, yearDiv) {
  const months = state.photoData[yearFolder];
  const group = document.createElement('div');
  group.className = 'month-group';
  const allItem = document.createElement('div');
  allItem.className = 'month-item active';
  const totalInYear = months.reduce((s, m) => s + m.photos.length, 0);
  allItem.innerHTML = `📂 全部 <span class="count">${totalInYear}张</span>`;
  allItem.addEventListener('click', (e) => {
    e.stopPropagation();
    group.querySelectorAll('.month-item').forEach(m => m.classList.remove('active'));
    allItem.classList.add('active');
    state.currentMonth = null;
    renderPhotoGrid(yearFolder, null);
  });
  group.appendChild(allItem);
  months.forEach(m => {
    const item = document.createElement('div');
    item.className = 'month-item';
    item.innerHTML = `${monthFolderLabel(m.monthFolder)} <span class="count">${m.photos.length}张</span>`;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      group.querySelectorAll('.month-item').forEach(mi => mi.classList.remove('active'));
      item.classList.add('active');
      state.currentMonth = m.monthFolder;
      renderPhotoGrid(yearFolder, m.monthFolder);
    });
    group.appendChild(item);
  });
  yearDiv.after(group);
}

// ==================== 照片网格 ====================
function renderPhotoGrid(yearFolder, monthFolder) {
  const grid = $('#photo-grid');
  grid.innerHTML = '';
  if (!yearFolder) {
    $('#current-section-title').textContent = '请选择年份查看照片';
    state.currentPhotos = [];
    return;
  }
  let photos = [];
  if (monthFolder) {
    const months = state.photoData[yearFolder];
    const found = months.find(m => m.monthFolder === monthFolder);
    if (found) photos = found.photos;
  } else {
    const months = state.photoData[yearFolder];
    for (const m of months) photos = photos.concat(m.photos);
  }
  state.currentPhotos = photos;
  const title = monthFolder
    ? `${yearFolderLabel(yearFolder)} · ${monthFolderLabel(monthFolder)}`
    : yearFolderLabel(yearFolder);
  $('#current-section-title').textContent = `${title} (${photos.length}张)`;
  const searchTerm = ($('#search-input').value || '').toLowerCase();
  let filtered = photos;
  if (searchTerm) filtered = photos.filter(p => p.name.toLowerCase().includes(searchTerm));

  // 按评分排序
  if (sortByScore) {
    filtered = [...filtered].sort((a, b) => scorePhoto(b) - scorePhoto(a));
  }

  // 恢复缩放状态
  const sliderVal = parseInt($('#grid-size-slider').value) || 2;
  sizeClasses.forEach(c => grid.classList.remove(c));
  grid.classList.add(sizeClasses[sliderVal - 1]);

  // 渐进渲染：大量照片时分批渲染，避免一次性渲染几千张卡顿
  const BATCH_SIZE = 80;
  let renderedCount = 0;

  function renderBatch() {
    const fragment = document.createDocumentFragment();
    const end = Math.min(renderedCount + BATCH_SIZE, filtered.length);
    for (let idx = renderedCount; idx < end; idx++) {
      const photo = filtered[idx];
      const card = document.createElement('div');
      card.className = 'photo-card';
      if (state.selectedPhotos.has(photo.path)) card.classList.add('selected');
      card.dataset.path = photo.path;
      card.dataset.idx = idx;
      // 使用 data-src 延迟加载图片
      const img = document.createElement('img');
      img.dataset.src = API.thumbnailUrl(photo.path);
      img.alt = photo.name;
      img.loading = 'lazy';
      card.appendChild(img);
      // 智能评分徽章
      const score = scorePhoto(photo);
      const scoreBadge = document.createElement('div');
      scoreBadge.className = 'photo-score-badge';
      scoreBadge.textContent = getScoreStars(score);
      scoreBadge.style.color = getScoreColor(score);
      scoreBadge.title = `推荐指数: ${score}/5 (文件大小: ${(photo.size / 1048576).toFixed(1)}MB)`;
      card.appendChild(scoreBadge);
      const check = document.createElement('div');
      check.className = 'check-overlay';
      check.textContent = state.selectedPhotos.has(photo.path) ? '✓' : '';
      card.appendChild(check);
      const name = document.createElement('div');
      name.className = 'photo-name';
      name.textContent = photo.name;
      card.appendChild(name);
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        // 点击缩略图 → 弹出大图预览
        const realIdx = photos.indexOf(photo);
        openLightbox(realIdx);
      });
      // 点击勾选圆圈 → 选入/取消精选
      check.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSelectPhoto(photo, card);
      });
      fragment.appendChild(card);
    }
    grid.appendChild(fragment);

    // 加载本批可见的图片
    loadBatchImages(grid);
    renderedCount = end;

    if (renderedCount < filtered.length) {
      // 下一批，用 requestIdleCallback 或 setTimeout
      requestAnimationFrame(() => {
        setTimeout(renderBatch, 50);
      });
    }
  }

  // 先渲染第一批
  renderedCount = 0;
  renderBatch();
  updateSelectedCount();
}

// 加载一批图片的 src（从 data-src 读取）
function loadBatchImages(grid) {
  const imgs = grid.querySelectorAll('img[data-src]:not([src])');
  const gridRect = grid.getBoundingClientRect();
  const viewTop = gridRect.top - 300;
  const viewBottom = gridRect.bottom + 300;

  for (let i = 0; i < Math.min(imgs.length, 60); i++) {
    const img = imgs[i];
    const rect = img.getBoundingClientRect();
    // 只加载可视区域附近的图片
    if (rect.bottom > viewTop && rect.top < viewBottom) {
      img.src = img.dataset.src;
      img.removeAttribute('data-src');
    }
  }

  // 滚动时加载更多
  grid._lazyScroll = () => {
    const remaining = grid.querySelectorAll('img[data-src]:not([src])');
    const gRect = grid.getBoundingClientRect();
    const vTop = gRect.top - 400;
    const vBot = gRect.bottom + 400;
    let loaded = 0;
    for (let i = 0; i < Math.min(remaining.length, 40); i++) {
      const img = remaining[i];
      const r = img.getBoundingClientRect();
      if (r.bottom > vTop && r.top < vBot) {
        img.src = img.dataset.src;
        img.removeAttribute('data-src');
        loaded++;
      }
    }
  };
  grid.removeEventListener('scroll', grid._lazyScroll);
  grid.addEventListener('scroll', grid._lazyScroll);
}

$('#search-input').addEventListener('input', () => {
  if (state.currentYear) renderPhotoGrid(state.currentYear, state.currentMonth);
});

// 评分排序按钮
$('#btn-sort-score').addEventListener('click', () => {
  setSortMode(!sortByScore);
});

// 缩略图缩放滑块
const sizeLabels = ['小', '中', '大'];
const sizeClasses = ['size-sm', 'size-md', 'size-lg'];
$('#grid-size-slider').addEventListener('input', (e) => {
  const val = parseInt(e.target.value);
  const grid = $('#photo-grid');
  sizeClasses.forEach(c => grid.classList.remove(c));
  grid.classList.add(sizeClasses[val - 1]);
  $('#grid-size-label').textContent = sizeLabels[val - 1];
  // 如果照片太多，用小图模式时自动开启渐进渲染
  if (state.currentYear) renderPhotoGrid(state.currentYear, state.currentMonth);
});

// ==================== 照片选择 ====================
function toggleSelectPhoto(photo, card) {
  if (state.selectedPhotos.has(photo.path)) {
    state.selectedPhotos.delete(photo.path);
    if (card) {
      card.classList.remove('selected');
      card.querySelector('.check-overlay').textContent = '';
    }
  } else {
    state.selectedPhotos.set(photo.path, photo);
    if (card) {
      card.classList.add('selected');
      card.querySelector('.check-overlay').textContent = '✓';
    }
  }
  updateSelectedCount();
  renderSelectedPanel();
  autoSave();
}
function updateSelectedCount() {
  $('#selected-count').textContent = `已选 ${state.selectedPhotos.size} 张`;
  $('#panel-count').textContent = state.selectedPhotos.size;
}
$('#btn-select-all').addEventListener('click', () => {
  const cards = $$('.photo-card');
  cards.forEach(card => {
    const path = card.dataset.path;
    if (!state.selectedPhotos.has(path)) {
      const photo = state.currentPhotos.find(p => p.path === path);
      if (photo) {
        state.selectedPhotos.set(path, photo);
        card.classList.add('selected');
        card.querySelector('.check-overlay').textContent = '✓';
      }
    }
  });
  updateSelectedCount();
  renderSelectedPanel();
  autoSave();
});
$('#btn-deselect-all').addEventListener('click', () => {
  $$('.photo-card').forEach(card => {
    card.classList.remove('selected');
    card.querySelector('.check-overlay').textContent = '';
  });
  state.selectedPhotos.clear();
  updateSelectedCount();
  renderSelectedPanel();
  autoSave();
});

// ==================== 已选面板 ====================
function renderSelectedPanel() {
  const container = $('#selected-list');
  container.innerHTML = '';
  const grouped = new Map();
  for (const [path, photo] of state.selectedPhotos) {
    const yf = photo.yearFolder || '未知';
    if (!grouped.has(yf)) grouped.set(yf, []);
    grouped.get(yf).push(photo);
  }
  const sortedYears = [...grouped.keys()].sort();
  for (const yf of sortedYears) {
    const header = document.createElement('div');
    header.style.cssText = 'font-size:11px;font-weight:600;color:#999;padding:4px 4px 2px;margin-top:4px;';
    header.textContent = yearFolderLabel(yf);
    container.appendChild(header);
    for (const photo of grouped.get(yf)) {
      const item = document.createElement('div');
      item.className = 'selected-item';
      const thumb = document.createElement('img');
      thumb.src = API.thumbnailUrl(photo.path);
      thumb.loading = 'lazy';
      // 点击缩略图弹出大图预览
      thumb.addEventListener('click', (e) => {
        e.stopPropagation();
        // 把当前精选列表中的所有照片传给 lightbox
        const allSelected = [...state.selectedPhotos.values()];
        const idx = allSelected.indexOf(photo);
        openLightboxForSelected(idx >= 0 ? idx : 0);
      });
      item.appendChild(thumb);
      const info = document.createElement('div');
      info.className = 'info';
      info.innerHTML = `<div class="name">${photo.name}</div><div class="date">${photo.monthFolder || ''}</div>`;
      item.appendChild(info);
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.selectedPhotos.delete(photo.path);
        updateSelectedCount();
        renderSelectedPanel();
        autoSave();
        const card = document.querySelector(`.photo-card[data-path="${CSS.escape(photo.path)}"]`);
        if (card) {
          card.classList.remove('selected');
          card.querySelector('.check-overlay').textContent = '';
        }
      });
      item.appendChild(removeBtn);
      container.appendChild(item);
    }
  }
  if (state.selectedPhotos.size === 0) {
    container.innerHTML = '<div style="text-align:center;color:#ccc;padding:20px;font-size:13px;">点击照片进行精选<br>双击查看大图</div>';
  }
}
$('#btn-clear-selected').addEventListener('click', () => {
  state.selectedPhotos.clear();
  updateSelectedCount();
  renderSelectedPanel();
  autoSave();
  $$('.photo-card').forEach(c => {
    c.classList.remove('selected');
    c.querySelector('.check-overlay').textContent = '';
  });
});

// ==================== 大图预览 ====================
let lightboxPhotos = null; // 用于精选面板预览的照片数组

function openLightbox(index) {
  state.lightboxIndex = index;
  const photo = state.currentPhotos[index];
  if (!photo) return;
  lightboxPhotos = null; // 使用 currentPhotos
  showLightboxPhoto(photo, index, state.currentPhotos.length);
}
function openLightboxForSelected(index) {
  state.lightboxIndex = index;
  const photos = [...state.selectedPhotos.values()];
  lightboxPhotos = photos;
  const photo = photos[index];
  if (!photo) return;
  showLightboxPhoto(photo, index, photos.length);
}
function showLightboxPhoto(photo, index, total) {
  $('#lightbox-img').src = API.fullImageUrl(photo.path);
  $('#lightbox-filename').textContent = photo.name;
  $('#lightbox').classList.remove('hidden');
  const selectBtn = $('#btn-lightbox-select');
  if (state.selectedPhotos.has(photo.path)) {
    selectBtn.textContent = '⭐ 取消精选';
  } else {
    selectBtn.textContent = '⭐ 选入精选';
  }
  $('#lightbox-prev').style.display = index > 0 ? 'flex' : 'none';
  $('#lightbox-next').style.display = index < total - 1 ? 'flex' : 'none';
}
function closeLightbox() {
  $('#lightbox').classList.add('hidden');
  state.lightboxIndex = -1;
}
$('#lightbox .lightbox-overlay').addEventListener('click', closeLightbox);
$('#lightbox .lightbox-close').addEventListener('click', closeLightbox);
function getLightboxTotal() {
  return lightboxPhotos ? lightboxPhotos.length : state.currentPhotos.length;
}
function getLightboxPhoto(index) {
  return lightboxPhotos ? lightboxPhotos[index] : state.currentPhotos[index];
}
function navigateLightbox(direction) {
  const newIdx = state.lightboxIndex + direction;
  if (newIdx < 0 || newIdx >= getLightboxTotal()) return;
  if (lightboxPhotos) {
    openLightboxForSelected(newIdx);
  } else {
    openLightbox(newIdx);
  }
}
$('#lightbox-prev').addEventListener('click', (e) => {
  e.stopPropagation();
  navigateLightbox(-1);
});
$('#lightbox-next').addEventListener('click', (e) => {
  e.stopPropagation();
  navigateLightbox(1);
});
$('#btn-lightbox-select').addEventListener('click', () => {
  const photo = getLightboxPhoto(state.lightboxIndex);
  if (!photo) return;
  const card = document.querySelector(`.photo-card[data-path="${CSS.escape(photo.path)}"]`);
  toggleSelectPhoto(photo, card);
  if (state.selectedPhotos.has(photo.path)) {
    $('#btn-lightbox-select').textContent = '⭐ 取消精选';
  } else {
    $('#btn-lightbox-select').textContent = '⭐ 选入精选';
  }
});
// ==================== 撤销历史栈 ====================
const undoStack = [];
const MAX_UNDO = 50;

function pushUndoState() {
  // 保存 albumPages 的深拷贝
  const snapshot = JSON.parse(JSON.stringify(state.albumPages));
  // 去重：如果和栈顶相同就不推入
  if (undoStack.length > 0) {
    const last = undoStack[undoStack.length - 1];
    if (JSON.stringify(last) === JSON.stringify(snapshot)) return;
  }
  undoStack.push(snapshot);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function undo() {
  if (undoStack.length <= 1) {
    showToast('没有更多可撤销的操作');
    return;
  }
  // 弹出当前状态，恢复到上一个
  undoStack.pop();
  const prev = undoStack[undoStack.length - 1];
  state.albumPages = JSON.parse(JSON.stringify(prev));
  renderAlbumPages();
  showToast('↩ 已撤销');
}

// ==================== 键盘快捷键 ====================
document.addEventListener('keydown', (e) => {
  // 不处理输入框中的按键
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.target.isContentEditable) return;

  const key = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;

  // 全局快捷键（所有视图都可用）
  if (e.key === 'Escape') closeLightbox();
  if (!$('#lightbox').classList.contains('hidden')) {
    if (e.key === 'ArrowLeft') navigateLightbox(-1);
    if (e.key === 'ArrowRight') navigateLightbox(1);
    return; // 灯箱模式下不处理其他快捷键
  }

  // Ctrl+S 保存
  if (ctrl && key === 's') {
    e.preventDefault();
    $('#btn-save').click();
    return;
  }

  // Ctrl+Z 撤销
  if (ctrl && key === 'z') {
    e.preventDefault();
    if (state.currentView === 'layout') undo();
    return;
  }

  // 排版视图专属快捷键
  if (state.currentView === 'layout') {
    const sel = state.selectedElement;
    if (!sel) return;

    // Delete / Backspace 删除选中元素
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const pageIndex = parseInt(sel.pageEl.dataset.pageIndex);
      const page = state.albumPages[pageIndex];
      if (page) {
        pushUndoState();
        page.elements = page.elements.filter(el => el.id !== sel.el.id);
        state.selectedElement = null;
        hideTextPropsBar();
        renderAlbumPages();
        showToast('🗑 已删除');
      }
      return;
    }

    // 方向键微调位置（每次1px，Shift+方向键=10px）
    const step = e.shiftKey ? 10 : 1;
    let moved = false;
    if (e.key === 'ArrowLeft') { sel.el.x = Math.max(0, sel.el.x - step); moved = true; }
    if (e.key === 'ArrowRight') { sel.el.x = Math.min(sel.pageEl.offsetWidth - sel.el.w, sel.el.x + step); moved = true; }
    if (e.key === 'ArrowUp') { sel.el.y = Math.max(0, sel.el.y - step); moved = true; }
    if (e.key === 'ArrowDown') { sel.el.y = Math.min(sel.pageEl.offsetHeight - sel.el.h, sel.el.y + step); moved = true; }
    if (moved) {
      e.preventDefault();
      sel.elDiv.style.left = sel.el.x + 'px';
      sel.elDiv.style.top = sel.el.y + 'px';
    }
  }
});

// ==================== 去排版按钮 ====================
$('#btn-go-layout').addEventListener('click', () => {
  if (state.selectedPhotos.size === 0) {
    showToast('请先精选一些照片');
    return;
  }
  if (state.albumPages.length === 0) {
    const photos = [...state.selectedPhotos.values()];
    state.albumPages = autoLayout(photos);
    showToast(`自动排版完成！共 ${state.albumPages.length} 页`);
  }
  switchView('layout');
});

// ==================== 自由排版：页面数据结构 ====================
// 每个页面是一个自由画布，包含 elements 数组
// element 类型: 'photo' | 'text'
// photo: { type, id, x, y, w, h, photo, caption, frame }
// text: { type, id, x, y, w, h, text, fontSize, color, align }

let elementIdCounter = 0;
function newElementId() {
  return 'el_' + (++elementIdCounter);
}

// ==================== 自动排版引擎（自由排版版） ====================
function autoLayout(photos) {
  const pages = [];
  const byYear = new Map();
  for (const photo of photos) {
    const yf = photo.yearFolder || '未分类';
    if (!byYear.has(yf)) byYear.set(yf, []);
    byYear.get(yf).push(photo);
  }
  const sortedYears = [...byYear.keys()].sort();

  for (const yf of sortedYears) {
    const yearPhotos = byYear.get(yf);
    // 年份封面页 - 自动生成但所有元素可编辑可删除
    const coverElements = [];
    // 年份数字
    const yearNum = yf.match(/^(\d{4})/) ? parseInt(yf.match(/^(\d{4})/)[1]) : null;
    coverElements.push({
      type: 'text', id: newElementId(),
      x: 210, y: 100, w: 200, h: 70,
      text: yearNum ? String(yearNum) : yf,
      fontSize: 64, color: 'var(--theme-primary)', align: 'center',
      fontWeight: '700', opacity: 0.7
    });
    // 副标题
    coverElements.push({
      type: 'text', id: newElementId(),
      x: 160, y: 190, w: 300, h: 40,
      text: '美好的时光',
      fontSize: 20, color: 'var(--theme-text-secondary)', align: 'center',
      letterSpacing: '6px'
    });
    // 照片区域（如果有照片）
    if (yearPhotos.length > 0) {
      coverElements.push({
        type: 'photo', id: newElementId(),
        x: 60, y: 260, w: 500, h: 380,
        photo: yearPhotos[0], caption: '', frame: 'clean'
      });
    }
    pages.push({
      type: 'free',
      yearLabel: yearFolderLabel(yf),
      elements: coverElements
    });

    // 其余照片按每页2-4张分配
    let i = yearPhotos.length > 0 ? 1 : 0;
    const pw = 620, ph = Math.round(620 / 0.705);
    while (i < yearPhotos.length) {
      const left = yearPhotos.length - i;
      const count = left >= 4 ? 4 : left >= 3 ? 3 : left >= 2 ? 2 : 1;
      const pagePhotos = yearPhotos.slice(i, i + count);
      const elements = [];
      if (count === 1) {
        elements.push({ type: 'photo', id: newElementId(), x: 60, y: 60, w: 500, h: ph - 120, photo: pagePhotos[0], caption: '', frame: 'clean' });
      } else if (count === 2) {
        const hw = Math.round((pw - 80) / 2);
        elements.push({ type: 'photo', id: newElementId(), x: 25, y: 60, w: hw, h: ph - 120, photo: pagePhotos[0], caption: '', frame: 'clean' });
        elements.push({ type: 'photo', id: newElementId(), x: 25 + hw + 30, y: 60, w: hw, h: ph - 120, photo: pagePhotos[1], caption: '', frame: 'clean' });
      } else if (count === 3) {
        elements.push({ type: 'photo', id: newElementId(), x: 30, y: 40, w: 560, h: Math.round((ph - 120) * 0.55), photo: pagePhotos[0], caption: '', frame: 'clean' });
        elements.push({ type: 'photo', id: newElementId(), x: 30, y: Math.round((ph - 120) * 0.55 + 60), w: 270, h: Math.round((ph - 120) * 0.4), photo: pagePhotos[1], caption: '', frame: 'clean' });
        elements.push({ type: 'photo', id: newElementId(), x: 320, y: Math.round((ph - 120) * 0.55 + 60), w: 270, h: Math.round((ph - 120) * 0.4), photo: pagePhotos[2], caption: '', frame: 'clean' });
      } else {
        const hw = Math.round((pw - 80) / 2);
        const hh = Math.round((ph - 100) / 2);
        elements.push({ type: 'photo', id: newElementId(), x: 25, y: 35, w: hw, h: hh, photo: pagePhotos[0], caption: '', frame: 'clean' });
        elements.push({ type: 'photo', id: newElementId(), x: 25 + hw + 30, y: 35, w: hw, h: hh, photo: pagePhotos[1], caption: '', frame: 'clean' });
        elements.push({ type: 'photo', id: newElementId(), x: 25, y: 35 + hh + 30, w: hw, h: hh, photo: pagePhotos[2], caption: '', frame: 'clean' });
        elements.push({ type: 'photo', id: newElementId(), x: 25 + hw + 30, y: 35 + hh + 30, w: hw, h: hh, photo: pagePhotos[3], caption: '', frame: 'clean' });
      }
      pages.push({
        type: 'free',
        yearLabel: yearFolderLabel(yf),
        elements: elements
      });
      i += count;
    }
  }
  return pages;
}

// ==================== 自动排版按钮 ====================
$('#btn-auto-layout').addEventListener('click', () => {
  if (state.selectedPhotos.size === 0) {
    showToast('请先在选片视图中精选照片');
    return;
  }
  const photos = [...state.selectedPhotos.values()];
  state.albumPages = autoLayout(photos);
  switchView('layout');
  showToast(`自动排版完成！共 ${state.albumPages.length} 页`);
});

// ==================== 渲染排版视图 ====================
function renderAlbumPages() {
  const container = $('#album-pages');
  container.innerHTML = '';
  if (state.albumPages.length === 0) {
    editingPageIndex = null;
    container.innerHTML = `
      <div class="empty-pages-hint" style="text-align:center;padding:60px;color:#999;min-height:300px;">
        <div style="font-size:48px;margin-bottom:16px;">📐</div>
        <div style="font-size:16px;margin-bottom:8px;">还没有排版</div>
        <div style="font-size:13px;">请先在选片视图中精选照片，然后点击 ✨"自动排版"</div>
        <div style="font-size:11px;margin-top:10px;color:#bbb;">💡 也可以直接将装饰素材拖到这里创建空白页</div>
      </div>
    `;
    renderPageNav();
    renderUnusedPhotos();
    return;
  }

  // 确保当前编辑页索引有效
  if (editingPageIndex === null || editingPageIndex >= state.albumPages.length) {
    editingPageIndex = 0;
  }

  const pageIndex = editingPageIndex;
  const page = state.albumPages[pageIndex];
  const pageWidth = 620;
  const pageHeight = Math.round(pageWidth / 0.705);

  const pageEl = document.createElement('div');
  pageEl.className = 'album-page free-layout-page';
  pageEl.style.width = pageWidth + 'px';
  pageEl.style.height = pageHeight + 'px';
  pageEl.dataset.pageIndex = pageIndex;
  if (page.bgColor) {
    pageEl.style.background = page.bgColor;
  }

  // 工具栏
  addFreePageToolbar(pageEl, page, pageIndex);

  // 渲染所有元素
  if (page.elements) {
    page.elements.forEach(el => {
      renderElement(pageEl, page, el, pageIndex);
    });
  }

  // ===== 拖拽放置区域 =====
  pageEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('application/decor-type')) {
      e.dataTransfer.dropEffect = 'copy';
    } else {
      e.dataTransfer.dropEffect = 'move';
    }
    pageEl.classList.add('drag-over');
  });
  pageEl.addEventListener('dragleave', () => {
    pageEl.classList.remove('drag-over');
  });
  pageEl.addEventListener('drop', (e) => {
    e.preventDefault();
    pageEl.classList.remove('drag-over');
    handleDropOnPage(e, page, pageIndex);
  });

  // 页码
  const pageNum = document.createElement('div');
  pageNum.className = 'page-number';
  pageNum.textContent = `${pageIndex + 1} / ${state.albumPages.length}`;
  pageEl.appendChild(pageNum);

  // 页面底部：添加新页面按钮
  const addNextBtn = document.createElement('button');
  addNextBtn.className = 'page-add-next-btn';
  addNextBtn.innerHTML = '<span>+</span> 添加新页面';
  addNextBtn.title = '在末尾添加新页面';
  addNextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.albumPages.push({
      type: 'free',
      yearLabel: '',
      elements: []
    });
    editingPageIndex = state.albumPages.length - 1;
    renderAlbumPages();
    renderPageNav();
    updateActivePageNav();
  });
  pageEl.appendChild(addNextBtn);

  // 翻页按钮：上一页 / 下一页
  const navRow = document.createElement('div');
  navRow.className = 'page-nav-arrows';
  navRow.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:16px;margin-top:16px;';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'btn btn-sm btn-outline';
  prevBtn.textContent = '◀ 上一页';
  prevBtn.disabled = (pageIndex === 0);
  prevBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pageIndex > 0) {
      editingPageIndex = pageIndex - 1;
      renderAlbumPages();
      renderPageNav();
      updateActivePageNav();
      updatePagePropsPanel();
    }
  });

  const pageIndicator = document.createElement('span');
  pageIndicator.style.cssText = 'font-size:13px;color:#888;';
  pageIndicator.textContent = `${pageIndex + 1} / ${state.albumPages.length}`;

  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn btn-sm btn-outline';
  nextBtn.textContent = '下一页 ▶';
  nextBtn.disabled = (pageIndex === state.albumPages.length - 1);
  nextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pageIndex < state.albumPages.length - 1) {
      editingPageIndex = pageIndex + 1;
      renderAlbumPages();
      renderPageNav();
      updateActivePageNav();
      updatePagePropsPanel();
    }
  });

  navRow.appendChild(prevBtn);
  navRow.appendChild(pageIndicator);
  navRow.appendChild(nextBtn);

  container.appendChild(pageEl);
  container.appendChild(navRow);

  // 渲染右侧面板
  renderPageNav();
  renderUnusedPhotos();
  updateActivePageNav();
  updatePagePropsPanel();
  autoSave();
}

// 渲染单个元素（照片或文字）
function renderElement(pageEl, page, el, pageIndex) {
  const elDiv = document.createElement('div');
  elDiv.className = 'free-element';
  elDiv.dataset.elementId = el.id;
  elDiv.style.left = el.x + 'px';
  elDiv.style.top = el.y + 'px';
  elDiv.style.width = el.w + 'px';
  elDiv.style.height = el.h + 'px';
  if (el.rotation) {
    elDiv.style.transform = `rotate(${el.rotation}deg)`;
  }

  if (el.type === 'photo') {
    elDiv.classList.add('free-photo');
    elDiv.draggable = true;
    if (el.photo) {
      // 拖拽开始
      elDiv.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/element-id', el.id);
        e.dataTransfer.setData('application/page-index', String(pageIndex));
        e.dataTransfer.setData('application/photo-path', el.photo.path);
        e.dataTransfer.effectAllowed = 'move';
        elDiv.classList.add('dragging');
      });
      elDiv.addEventListener('dragend', () => {
        elDiv.classList.remove('dragging');
      });
      const img = document.createElement('img');
      img.src = API.thumbnailUrl(el.photo.path);
      img.draggable = false; // 阻止图片默认拖拽，使用外层 div 的拖拽
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      // 边框样式
      if (el.frame === 'rounded') img.style.borderRadius = '12px';
      else if (el.frame === 'polaroid') {
        elDiv.style.padding = '8px 8px 32px 8px';
        elDiv.style.background = 'white';
        elDiv.style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)';
      } else if (el.frame === 'shadow') {
        elDiv.style.boxShadow = '0 8px 24px rgba(0,0,0,0.18)';
      } else if (el.frame === 'vintage') {
        img.style.border = '4px solid #f0e6d3';
        img.style.padding = '2px';
        img.style.background = '#fdf8f0';
      } else {
        img.style.border = '6px solid white';
        img.style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)';
      }
      elDiv.appendChild(img);

      // 照片标题输入
      if (el.caption !== undefined) {
        const captionDiv = document.createElement('div');
        captionDiv.className = 'photo-caption';
        captionDiv.style.cssText = 'position:absolute;bottom:0;left:0;right:0;';
        const captionInput = document.createElement('input');
        captionInput.type = 'text';
        captionInput.placeholder = '标题...';
        captionInput.value = el.caption || '';
        captionInput.addEventListener('input', (e) => {
          el.caption = e.target.value;
        });
        // 阻止输入框的点击/拖拽事件冒泡到 elDiv，避免触发照片拖拽
        captionInput.addEventListener('mousedown', (e) => {
          e.stopPropagation();
        });
        captionInput.addEventListener('click', (e) => {
          e.stopPropagation();
        });
        captionDiv.appendChild(captionInput);
        elDiv.appendChild(captionDiv);
      }
    } else {
      elDiv.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#ccc;font-size:13px;border:2px dashed #ddd;">+ 点击添加照片</div>';
    }
  } else if (el.type === 'text') {
    elDiv.classList.add('free-text');
    const textarea = document.createElement('textarea');
    textarea.value = el.text || '';
    textarea.style.cssText = `
      width:100%;height:100%;border:none;background:transparent;
      font-size:${el.fontSize || 16}px;
      color:${el.color || 'var(--theme-text)'};
      text-align:${el.align || 'left'};
      font-weight:${el.fontWeight || 'normal'};
      font-style:${el.fontStyle || 'normal'};
      letter-spacing:${el.letterSpacing || 0}px;
      resize:none;outline:none;
      font-family:${el.fontFamily || 'var(--theme-font-body)'};
      line-height:${el.lineHeight || 1.4};
      cursor:text;
    `;
    if (el.opacity) textarea.style.opacity = el.opacity;
    textarea.placeholder = '输入文字...';
    textarea.addEventListener('input', (e) => {
      el.text = e.target.value;
    });
    // 阻止 textarea 的 mousedown 冒泡到 elDiv，避免触发拖拽
    textarea.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
    elDiv.appendChild(textarea);
  }

  // 选中状态边框
  const selectBorder = document.createElement('div');
  selectBorder.className = 'element-select-border';
  elDiv.appendChild(selectBorder);

  // 调整大小手柄
  const handles = ['nw', 'ne', 'sw', 'se'];
  handles.forEach(h => {
    const handle = document.createElement('div');
    handle.className = `resize-handle resize-${h}`;
    handle.dataset.handle = h;
    elDiv.appendChild(handle);
  });

  // 删除/退回按钮
  const delBtn = document.createElement('button');
  delBtn.className = 'element-delete-btn';
  delBtn.textContent = '×';
  delBtn.title = el.type === 'photo' && el.photo ? '退回素材库' : '删除元素';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (el.type === 'photo' && el.photo) {
      // 退回素材库：从页面移除，照片回到待用素材
      removeElementFromPage(page, el);
    } else {
      // 非照片元素直接删除
      page.elements = page.elements.filter(e => e.id !== el.id);
    }
    if (state.selectedElement && state.selectedElement.el.id === el.id) {
      state.selectedElement = null;
      hideTextPropsBar();
    }
    renderAlbumPages();
  });
  elDiv.appendChild(delBtn);

  // 旋转手柄
  const rotateHandle = document.createElement('div');
  rotateHandle.className = 'rotate-handle';
  rotateHandle.title = '旋转';
  rotateHandle.innerHTML = '↻';
  rotateHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startRotate(el, elDiv, pageEl, e);
  });
  elDiv.appendChild(rotateHandle);

  // 点击选中（文字框：点击边框/空白处选中并拖拽；textarea内部点击不触发拖拽）
  elDiv.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('resize-handle')) return;
    if (e.target.classList.contains('rotate-handle')) return;
    if (e.target.classList.contains('element-delete-btn')) return;
    // textarea 内部的点击由 textarea 自己的 mousedown 处理（stopPropagation），不会到这里
    // 如果点击的是 textarea 且冒泡到了这里（理论上不会），也不触发拖拽
    if (e.target.tagName === 'TEXTAREA') return;
    // 照片元素：使用原生 HTML5 拖拽，不能 preventDefault，否则 dragstart 无法触发
    if (el.type === 'photo' && el.photo) {
      // 仅选中，不阻止默认行为，让浏览器处理拖拽
      e.stopPropagation();
      selectElementWithoutDrag(el, elDiv, pageEl);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    selectElement(el, elDiv, pageEl, e);
  });

  // 照片元素：点击空白处添加照片
  if (el.type === 'photo' && !el.photo) {
    elDiv.addEventListener('click', () => {
      pickPhotoForElement(page, el);
    });
  }

  pageEl.appendChild(elDiv);
}

// 选中元素但不开始自定义拖拽（用于照片元素，由原生 HTML5 拖拽处理移动）
function selectElementWithoutDrag(el, elDiv, pageEl) {
  $$('.free-element').forEach(d => d.classList.remove('selected'));
  elDiv.classList.add('selected');
  state.selectedElement = { el, elDiv, pageEl };
  state.isDragging = false;
  updateTextPropsBar(el);
}

// 选中元素并开始拖拽
function selectElement(el, elDiv, pageEl, e) {
  // 取消之前选中的
  $$('.free-element').forEach(d => d.classList.remove('selected'));
  elDiv.classList.add('selected');
  state.selectedElement = { el, elDiv, pageEl };
  state.isDragging = true;
  const rect = elDiv.getBoundingClientRect();
  const pageRect = pageEl.getBoundingClientRect();
  state.dragOffset = {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
  // 更新文字属性栏
  updateTextPropsBar(el);
}

// 全局鼠标事件（拖拽和调整大小）
const SNAP_THRESHOLD = 6; // 吸附阈值 6px
const ALIGN_GUIDE_ID = 'align-guide-overlay';

function getAlignGuides(draggingEl, pageEl, page) {
  const guides = { h: [], v: [] }; // { pos, type }
  const dLeft = draggingEl.x, dRight = draggingEl.x + draggingEl.w;
  const dTop = draggingEl.y, dBottom = draggingEl.y + draggingEl.h;
  const dCx = draggingEl.x + draggingEl.w / 2;
  const dCy = draggingEl.y + draggingEl.h / 2;

  // 画布中线
  const pw = pageEl.offsetWidth, ph = pageEl.offsetHeight;
  guides.v.push({ pos: pw / 2, type: 'canvas-center' });
  guides.h.push({ pos: ph / 2, type: 'canvas-center' });

  // 其他元素的对齐线
  if (page.elements) {
    page.elements.forEach(other => {
      if (other === draggingEl) return;
      const oLeft = other.x, oRight = other.x + other.w;
      const oTop = other.y, oBottom = other.y + other.h;
      const oCx = other.x + other.w / 2;
      const oCy = other.y + other.h / 2;

      // 水平对齐线（Y轴方向）
      guides.h.push({ pos: oTop, type: 'top' });
      guides.h.push({ pos: oBottom, type: 'bottom' });
      guides.h.push({ pos: oCy, type: 'center' });
      // 垂直对齐线（X轴方向）
      guides.v.push({ pos: oLeft, type: 'left' });
      guides.v.push({ pos: oRight, type: 'right' });
      guides.v.push({ pos: oCx, type: 'center' });
    });
  }

  // 匹配吸附
  const result = { snapX: null, snapY: null, hGuides: [], vGuides: [] };
  // 垂直对齐（X方向）
  for (const g of guides.v) {
    if (Math.abs(dLeft - g.pos) < SNAP_THRESHOLD) {
      result.snapX = g.pos;
      result.vGuides.push({ pos: g.pos, type: 'left', target: g.type });
      break;
    }
    if (Math.abs(dRight - g.pos) < SNAP_THRESHOLD) {
      result.snapX = g.pos - draggingEl.w;
      result.vGuides.push({ pos: g.pos, type: 'right', target: g.type });
      break;
    }
    if (Math.abs(dCx - g.pos) < SNAP_THRESHOLD) {
      result.snapX = g.pos - draggingEl.w / 2;
      result.vGuides.push({ pos: g.pos, type: 'center', target: g.type });
      break;
    }
  }
  // 水平对齐（Y方向）
  for (const g of guides.h) {
    if (Math.abs(dTop - g.pos) < SNAP_THRESHOLD) {
      result.snapY = g.pos;
      result.hGuides.push({ pos: g.pos, type: 'top', target: g.type });
      break;
    }
    if (Math.abs(dBottom - g.pos) < SNAP_THRESHOLD) {
      result.snapY = g.pos - draggingEl.h;
      result.hGuides.push({ pos: g.pos, type: 'bottom', target: g.type });
      break;
    }
    if (Math.abs(dCy - g.pos) < SNAP_THRESHOLD) {
      result.snapY = g.pos - draggingEl.h / 2;
      result.hGuides.push({ pos: g.pos, type: 'center', target: g.type });
      break;
    }
  }
  return result;
}

function showAlignGuides(pageEl, guides) {
  let overlay = pageEl.querySelector(`.${ALIGN_GUIDE_ID}`);
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = ALIGN_GUIDE_ID;
    overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;';
    pageEl.appendChild(overlay);
  }
  overlay.innerHTML = '';
  const ph = pageEl.offsetHeight;
  guides.vGuides.forEach(g => {
    const line = document.createElement('div');
    line.style.cssText = `position:absolute;left:${g.pos}px;top:0;width:1px;height:${ph}px;background:#ff4081;opacity:0.8;`;
    overlay.appendChild(line);
  });
  guides.hGuides.forEach(g => {
    const line = document.createElement('div');
    line.style.cssText = `position:absolute;left:0;top:${g.pos}px;width:100%;height:1px;background:#ff4081;opacity:0.8;`;
    overlay.appendChild(line);
  });
}

function hideAlignGuides(pageEl) {
  const overlay = pageEl.querySelector(`.${ALIGN_GUIDE_ID}`);
  if (overlay) overlay.remove();
}

document.addEventListener('mousemove', (e) => {
  if (state.isDragging && state.selectedElement) {
    e.preventDefault();
    const { el, elDiv, pageEl } = state.selectedElement;
    const pageIndex = parseInt(pageEl.dataset.pageIndex);
    const page = state.albumPages[pageIndex];
    const pageRect = pageEl.getBoundingClientRect();
    let newX = e.clientX - pageRect.left - state.dragOffset.x;
    let newY = e.clientY - pageRect.top - state.dragOffset.y;

    // 限制在页面内
    const maxX = pageEl.offsetWidth - el.w;
    const maxY = pageEl.offsetHeight - el.h;
    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    // 对齐辅助线检测
    const tempEl = { ...el, x: newX, y: newY };
    const align = getAlignGuides(tempEl, pageEl, page);
    if (align.snapX !== null) newX = align.snapX;
    if (align.snapY !== null) newY = align.snapY;
    if (align.vGuides.length > 0 || align.hGuides.length > 0) {
      showAlignGuides(pageEl, align);
    } else {
      hideAlignGuides(pageEl);
    }

    el.x = Math.round(newX);
    el.y = Math.round(newY);
    elDiv.style.left = el.x + 'px';
    elDiv.style.top = el.y + 'px';
  }
  if (state.isResizing && state.selectedElement) {
    e.preventDefault();
    const { el, elDiv, pageEl } = state.selectedElement;
    const pageRect = pageEl.getBoundingClientRect();
    const mouseX = e.clientX - pageRect.left;
    const mouseY = e.clientY - pageRect.top;
    const handle = state.resizeHandle;
    let newX = el.x, newY = el.y, newW = el.w, newH = el.h;
    const minSize = 30;
    if (handle.includes('e')) newW = Math.max(minSize, mouseX - el.x);
    if (handle.includes('s')) newH = Math.max(minSize, mouseY - el.y);
    if (handle.includes('w')) {
      const right = el.x + el.w;
      newX = Math.min(mouseX, right - minSize);
      newW = right - newX;
    }
    if (handle.includes('n')) {
      const bottom = el.y + el.h;
      newY = Math.min(mouseY, bottom - minSize);
      newH = bottom - newY;
    }
    el.x = Math.round(newX);
    el.y = Math.round(newY);
    el.w = Math.round(newW);
    el.h = Math.round(newH);
    elDiv.style.left = el.x + 'px';
    elDiv.style.top = el.y + 'px';
    elDiv.style.width = el.w + 'px';
    elDiv.style.height = el.h + 'px';
  }
  if (state.isRotating && state.selectedElement) {
    e.preventDefault();
    const { el, elDiv, pageEl } = state.selectedElement;
    const pageRect = pageEl.getBoundingClientRect();
    const cx = pageRect.left + el.x + el.w / 2;
    const cy = pageRect.top + el.y + el.h / 2;
    const angle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
    // 对齐到 5 度步进（按住 shift 精确对齐）
    const step = e.shiftKey ? 1 : 5;
    const snapped = Math.round(angle / step) * step;
    el.rotation = snapped;
    elDiv.style.transform = `rotate(${snapped}deg)`;
  }
});

let _dragStarted = false;
document.addEventListener('mousedown', (e) => {
  // 标记即将开始拖拽/调整大小/旋转（在 selectElement 之后）
  if (e.target.closest('.free-element') || e.target.classList.contains('resize-handle') || e.target.classList.contains('rotate-handle')) {
    if (!_dragStarted) {
      pushUndoState();
      _dragStarted = true;
    }
  }
});

document.addEventListener('mouseup', () => {
  // 清除对齐辅助线
  if (state.selectedElement && state.selectedElement.pageEl) {
    hideAlignGuides(state.selectedElement.pageEl);
  }
  if (state.isDragging || state.isResizing || state.isRotating) {
    _dragStarted = false;
  }
  state.isDragging = false;
  state.isResizing = false;
  state.isRotating = false;
  state.resizeHandle = null;
});

// 调整大小手柄事件
document.addEventListener('mousedown', (e) => {
  if (e.target.classList.contains('resize-handle')) {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.target.dataset.handle;
    const elDiv = e.target.closest('.free-element');
    const pageEl = elDiv.closest('.album-page');
    const pageIndex = parseInt(pageEl.dataset.pageIndex);
    const elId = elDiv.dataset.elementId;
    const page = state.albumPages[pageIndex];
    const el = page.elements.find(e => e.id === elId);
    state.selectedElement = { el, elDiv, pageEl };
    state.isResizing = true;
    state.resizeHandle = handle;
    $$('.free-element').forEach(d => d.classList.remove('selected'));
    elDiv.classList.add('selected');
    updateTextPropsBar(el);
  }
});

// 开始旋转
function startRotate(el, elDiv, pageEl, e) {
  $$('.free-element').forEach(d => d.classList.remove('selected'));
  elDiv.classList.add('selected');
  state.selectedElement = { el, elDiv, pageEl };
  state.isRotating = true;
  updateTextPropsBar(el);
}

// 点击页面空白处或文字框外部取消选中
document.addEventListener('mousedown', (e) => {
  const clickedEl = e.target.closest('.free-element');
  const clickedProps = e.target.closest('#text-props-bar');
  if (!clickedEl && !clickedProps) {
    // 点击了页面空白处（不是属性栏）
    $$('.free-element').forEach(d => d.classList.remove('selected'));
    state.selectedElement = null;
    hideTextPropsBar();
  }
});

// ==================== 页面工具栏 ====================
function addFreePageToolbar(pageEl, page, pageIndex) {
  const toolbar = document.createElement('div');
  toolbar.className = 'page-toolbar';

  // 添加照片按钮
  const addPhotoBtn = document.createElement('button');
  addPhotoBtn.textContent = '+ 照片';
  addPhotoBtn.addEventListener('click', () => {
    pickPhotoForElement(page, null, true);
  });
  toolbar.appendChild(addPhotoBtn);

  // 添加文字按钮
  const addTextBtn = document.createElement('button');
  addTextBtn.textContent = '+ 文字';
  addTextBtn.addEventListener('click', () => {
    if (!page.elements) page.elements = [];
    page.elements.push({
      type: 'text', id: newElementId(),
      x: 60, y: 60, w: 200, h: 40,
      text: '', fontSize: 16, color: 'var(--theme-text)', align: 'left'
    });
    renderAlbumPages();
  });
  toolbar.appendChild(addTextBtn);

  // 插入新页
  const addBtn = document.createElement('button');
  addBtn.textContent = '+ 插入页';
  addBtn.addEventListener('click', () => {
    state.albumPages.splice(pageIndex + 1, 0, {
      type: 'free',
      yearLabel: page.yearLabel,
      elements: []
    });
    renderAlbumPages();
  });
  toolbar.appendChild(addBtn);

  // 删除页面
  const delBtn = document.createElement('button');
  delBtn.textContent = '删除页';
  delBtn.addEventListener('click', () => {
    if (confirm('确定删除这一页吗？')) {
      state.albumPages.splice(pageIndex, 1);
      renderAlbumPages();
    }
  });
  toolbar.appendChild(delBtn);

  pageEl.appendChild(toolbar);
}

// ==================== 文字属性工具栏 ====================
function updateTextPropsBar(el) {
  const bar = $('#text-props-bar');
  if (!el || el.type !== 'text') {
    hideTextPropsBar();
    return;
  }
  bar.classList.remove('hidden');
  state.textPropsVisible = true;

  // 字体
  const fontSelect = $('#text-font-family');
  fontSelect.value = el.fontFamily || '';
  // 字号
  $('#text-font-size').value = el.fontSize || 16;
  // 颜色
  const colorVal = (el.color || '#333333').replace('var(--theme-text)', '#333333');
  $('#text-color').value = colorVal;
  // 对齐
  updateAlignButtons(el.align || 'left');
  // 加粗
  const boldBtn = $('#text-btn-bold');
  if (el.fontWeight === 'bold' || el.fontWeight === '700') boldBtn.classList.add('active');
  else boldBtn.classList.remove('active');
  // 斜体
  const italicBtn = $('#text-btn-italic');
  if (el.fontStyle === 'italic') italicBtn.classList.add('active');
  else italicBtn.classList.remove('active');
  // 字间距
  $('#text-letter-spacing').value = el.letterSpacing || 0;
  // 行高
  $('#text-line-height').value = el.lineHeight || 1.4;
  // 透明度
  $('#text-opacity').value = el.opacity ? parseInt(el.opacity * 100) : 100;
}

function hideTextPropsBar() {
  const bar = $('#text-props-bar');
  bar.classList.add('hidden');
  state.textPropsVisible = false;
}

function updateAlignButtons(align) {
  ['left', 'center', 'right'].forEach(a => {
    const btn = $(`#text-btn-${a}`);
    if (a === align) btn.classList.add('active');
    else btn.classList.remove('active');
  });
}

function applyTextProp(prop, value) {
  const sel = state.selectedElement;
  if (!sel || sel.el.type !== 'text') return;
  sel.el[prop] = value;
  // 实时更新 textarea 样式
  const textarea = sel.elDiv.querySelector('textarea');
  if (textarea) {
    if (prop === 'fontSize') textarea.style.fontSize = value + 'px';
    else if (prop === 'color') textarea.style.color = value;
    else if (prop === 'align') textarea.style.textAlign = value;
    else if (prop === 'fontWeight') textarea.style.fontWeight = value;
    else if (prop === 'fontStyle') textarea.style.fontStyle = value;
    else if (prop === 'letterSpacing') textarea.style.letterSpacing = value + 'px';
    else if (prop === 'lineHeight') textarea.style.lineHeight = value;
    else if (prop === 'fontFamily') textarea.style.fontFamily = value || 'var(--theme-font-body)';
    else if (prop === 'opacity') textarea.style.opacity = value;
  }
}

// 字体家族
$('#text-font-family').addEventListener('change', (e) => {
  applyTextProp('fontFamily', e.target.value);
});

// 字号
$('#text-font-size').addEventListener('input', (e) => {
  const val = parseInt(e.target.value) || 16;
  applyTextProp('fontSize', Math.max(8, Math.min(200, val)));
});

// 颜色
$('#text-color').addEventListener('input', (e) => {
  applyTextProp('color', e.target.value);
});

// 加粗
$('#text-btn-bold').addEventListener('click', () => {
  const sel = state.selectedElement;
  if (!sel || sel.el.type !== 'text') return;
  const current = sel.el.fontWeight === 'bold' || sel.el.fontWeight === '700';
  sel.el.fontWeight = current ? 'normal' : 'bold';
  if (current) $('#text-btn-bold').classList.remove('active');
  else $('#text-btn-bold').classList.add('active');
  applyTextProp('fontWeight', sel.el.fontWeight);
});

// 斜体
$('#text-btn-italic').addEventListener('click', () => {
  const sel = state.selectedElement;
  if (!sel || sel.el.type !== 'text') return;
  const current = sel.el.fontStyle === 'italic';
  sel.el.fontStyle = current ? 'normal' : 'italic';
  if (current) $('#text-btn-italic').classList.remove('active');
  else $('#text-btn-italic').classList.add('active');
  applyTextProp('fontStyle', sel.el.fontStyle);
});

// 对齐
$('#text-btn-left').addEventListener('click', () => {
  applyTextProp('align', 'left');
  updateAlignButtons('left');
});
$('#text-btn-center').addEventListener('click', () => {
  applyTextProp('align', 'center');
  updateAlignButtons('center');
});
$('#text-btn-right').addEventListener('click', () => {
  applyTextProp('align', 'right');
  updateAlignButtons('right');
});

// 字间距
$('#text-letter-spacing').addEventListener('input', (e) => {
  applyTextProp('letterSpacing', parseFloat(e.target.value) || 0);
});

// 行高
$('#text-line-height').addEventListener('input', (e) => {
  applyTextProp('lineHeight', parseFloat(e.target.value) || 1.4);
});

// 透明度
$('#text-opacity').addEventListener('input', (e) => {
  const val = parseInt(e.target.value) / 100;
  applyTextProp('opacity', val);
});

// 复制文字元素
$('#text-btn-duplicate').addEventListener('click', () => {
  const sel = state.selectedElement;
  if (!sel || sel.el.type !== 'text') return;
  const pageEl = sel.elDiv.closest('.album-page');
  const pageIndex = parseInt(pageEl.dataset.pageIndex);
  const page = state.albumPages[pageIndex];
  const newEl = { ...sel.el, id: newElementId(), x: sel.el.x + 20, y: sel.el.y + 20 };
  page.elements.push(newEl);
  renderAlbumPages();
});

// 上移一层
$('#text-btn-layer-up').addEventListener('click', () => {
  const sel = state.selectedElement;
  if (!sel) return;
  const pageEl = sel.elDiv.closest('.album-page');
  const pageIndex = parseInt(pageEl.dataset.pageIndex);
  const page = state.albumPages[pageIndex];
  const idx = page.elements.findIndex(e => e.id === sel.el.id);
  if (idx < page.elements.length - 1) {
    [page.elements[idx], page.elements[idx + 1]] = [page.elements[idx + 1], page.elements[idx]];
    renderAlbumPages();
  }
});

// 下移一层
$('#text-btn-layer-down').addEventListener('click', () => {
  const sel = state.selectedElement;
  if (!sel) return;
  const pageEl = sel.elDiv.closest('.album-page');
  const pageIndex = parseInt(pageEl.dataset.pageIndex);
  const page = state.albumPages[pageIndex];
  const idx = page.elements.findIndex(e => e.id === sel.el.id);
  if (idx > 0) {
    [page.elements[idx], page.elements[idx - 1]] = [page.elements[idx - 1], page.elements[idx]];
    renderAlbumPages();
  }
});

// 选择照片放入元素
function pickPhotoForElement(page, existingEl = null, createNew = false) {
  const photos = [...state.selectedPhotos.values()];
  if (photos.length === 0) {
    showToast('请先在选片视图中精选照片');
    return;
  }

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:500;display:flex;align-items:center;justify-content:center;';

  const panel = document.createElement('div');
  panel.style.cssText = 'background:white;border-radius:8px;padding:16px;max-width:750px;max-height:85vh;display:flex;flex-direction:column;';
  panel.innerHTML = '<h3 style="margin-bottom:12px;">选择照片</h3>';

  const scrollDiv = document.createElement('div');
  scrollDiv.style.cssText = 'overflow-y:auto;flex:1;';

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;';

  photos.forEach(photo => {
    const card = document.createElement('div');
    card.style.cssText = 'aspect-ratio:1;border-radius:4px;overflow:hidden;cursor:pointer;border:2px solid transparent;transition:border-color 0.2s;';
    const img = document.createElement('img');
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
    img.src = API.thumbnailUrl(photo.path);
    img.loading = 'lazy';
    card.appendChild(img);
    const name = document.createElement('div');
    name.style.cssText = 'font-size:10px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px;';
    name.textContent = photo.name;
    card.appendChild(name);

    card.addEventListener('click', () => {
      if (createNew) {
        if (!page.elements) page.elements = [];
        page.elements.push({
          type: 'photo', id: newElementId(),
          x: 60, y: 60, w: 200, h: 200,
          photo, caption: '', frame: state.frameStyle
        });
      } else if (existingEl) {
        existingEl.photo = photo;
        existingEl.frame = state.frameStyle;
      }
      document.body.removeChild(overlay);
      renderAlbumPages();
    });
    card.addEventListener('mouseenter', () => card.style.borderColor = 'var(--accent)');
    card.addEventListener('mouseleave', () => card.style.borderColor = 'transparent');

    grid.appendChild(card);
  });

  scrollDiv.appendChild(grid);
  panel.appendChild(scrollDiv);
  overlay.appendChild(panel);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) document.body.removeChild(overlay);
  });
  document.body.appendChild(overlay);
}

// ==================== 预览视图 ====================
function renderPreview() {
  const canvas = $('#preview-canvas');
  canvas.innerHTML = '';
  if (state.albumPages.length === 0) {
    canvas.innerHTML = '<div style="color:white;text-align:center;padding:60px;">请先完成排版</div>';
    return;
  }
  $('#preview-page-info').textContent =
    `第 ${state.previewPage + 1} 页 / 共 ${state.albumPages.length} 页`;

  const page = state.albumPages[state.previewPage];
  const zoom = state.previewZoom / 100;
  const baseW = 620;
  const baseH = Math.round(baseW / 0.705);

  const pageEl = document.createElement('div');
  pageEl.className = 'preview-page';
  pageEl.style.width = (baseW * zoom) + 'px';
  pageEl.style.height = (baseH * zoom) + 'px';
  pageEl.style.background = 'var(--theme-bg-page)';
  pageEl.style.position = 'relative';
  pageEl.style.overflow = 'hidden';

  if (page.elements) {
    page.elements.forEach(el => {
      renderPreviewElement(pageEl, el, zoom);
    });
  }

  canvas.appendChild(pageEl);
}

function renderPreviewElement(pageEl, el, zoom) {
  const elDiv = document.createElement('div');
  elDiv.style.position = 'absolute';
  elDiv.style.left = (el.x * zoom) + 'px';
  elDiv.style.top = (el.y * zoom) + 'px';
  elDiv.style.width = (el.w * zoom) + 'px';
  elDiv.style.height = (el.h * zoom) + 'px';
  if (el.rotation) {
    elDiv.style.transform = `rotate(${el.rotation}deg)`;
    elDiv.style.transformOrigin = 'center center';
  }

  if (el.type === 'photo' && el.photo) {
    const img = document.createElement('img');
    img.src = API.thumbnailUrl(el.photo.path);
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
    if (el.frame === 'rounded') img.style.borderRadius = (8 * zoom) + 'px';
    else if (el.frame === 'polaroid') {
      elDiv.style.padding = `${4 * zoom}px ${4 * zoom}px ${16 * zoom}px ${4 * zoom}px`;
      elDiv.style.background = 'white';
    } else if (el.frame === 'shadow') {
      img.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    } else if (el.frame === 'vintage') {
      img.style.border = `${3 * zoom}px solid #f0e6d3`;
    } else {
      img.style.border = `${3 * zoom}px solid white`;
    }
    elDiv.appendChild(img);
    if (el.caption) {
      const cap = document.createElement('div');
      cap.style.cssText = 'position:absolute;bottom:0;left:0;right:0;padding:4px;background:rgba(255,255,255,0.9);font-size:10px;text-align:center;color:#666;';
      cap.textContent = el.caption;
      elDiv.appendChild(cap);
    }
  } else if (el.type === 'text') {
    const textDiv = document.createElement('div');
    textDiv.style.cssText = `
      width:100%;height:100%;
      font-size:${(el.fontSize || 16) * zoom}px;
      color:${el.color || 'var(--theme-text)'};
      text-align:${el.align || 'left'};
      font-weight:${el.fontWeight || 'normal'};
      font-style:${el.fontStyle || 'normal'};
      letter-spacing:${el.letterSpacing || 0}px;
      font-family:${el.fontFamily || 'var(--theme-font-body)'};
      line-height:${el.lineHeight || 1.4};
      word-wrap:break-word;
    `;
    if (el.opacity) textDiv.style.opacity = el.opacity;
    textDiv.textContent = el.text || '';
    elDiv.appendChild(textDiv);
  } else if (el.type === 'decor') {
    if (el.subtype === 'emoji') {
      const span = document.createElement('span');
      span.textContent = el.emoji;
      span.style.cssText = `font-size:${(el.fontSize || 40) * zoom}px;line-height:1;display:flex;align-items:center;justify-content:center;width:100%;height:100%;`;
      elDiv.appendChild(span);
    } else if (el.subtype === 'svg' || el.subtype === 'border') {
      const svgWrap = document.createElement('div');
      svgWrap.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';
      svgWrap.innerHTML = el.svgContent;
      elDiv.appendChild(svgWrap);
    }
  }

  pageEl.appendChild(elDiv);
}

$('#btn-prev-page').addEventListener('click', () => {
  if (state.previewPage > 0) {
    state.previewPage--;
    renderPreview();
  }
});
$('#btn-next-page').addEventListener('click', () => {
  if (state.previewPage < state.albumPages.length - 1) {
    state.previewPage++;
    renderPreview();
  }
});
$('#preview-zoom').addEventListener('input', (e) => {
  state.previewZoom = parseInt(e.target.value);
  $('#zoom-label').textContent = state.previewZoom + '%';
  renderPreview();
});

// ==================== 保存/打开项目 ====================
$('#btn-save').addEventListener('click', () => {
  const projectData = {
    rootDir: state.rootDir,
    selectedPhotos: [...state.selectedPhotos.values()],
    albumPages: state.albumPages,
    theme: state.theme,
    albumTitle: state.albumTitle,
    albumSubtitle: state.albumSubtitle,
    coverPhoto: state.coverPhoto,
    frameStyle: state.frameStyle,
    showDecorations: state.showDecorations,
    version: '3.0'
  };
  const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '相册排版.album';
  a.click();
  URL.revokeObjectURL(url);
  _hasUnsavedChanges = false;
  showToast('✅ 项目已保存（已下载 .album 文件）');
});

$('#btn-open').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.album';
  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      state.rootDir = data.rootDir;
      state.selectedPhotos = new Map();
      if (data.selectedPhotos) {
        for (const p of data.selectedPhotos) state.selectedPhotos.set(p.path, p);
      }
      state.albumPages = data.albumPages || [];
      // 兼容旧项目
      for (const p of state.albumPages) {
        if (p.type === 'section-cover' || p.type === 'highlight' || p.type === 'page') {
          p.type = 'free';
          if (!p.elements) {
            p.elements = [];
            // 迁移旧数据到自由元素
            if (p.slots) {
              p.slots.forEach((slot, i) => {
                if (slot && slot.photo) {
                  p.elements.push({
                    type: 'photo', id: newElementId(),
                    x: 30 + (i % 2) * 230, y: 60 + Math.floor(i / 2) * 260,
                    w: 200, h: 240,
                    photo: slot.photo, caption: slot.caption || '', frame: slot.frame || 'clean'
                  });
                }
              });
            }
            if (p.texts) {
              p.texts.forEach((t, i) => {
                if (t) {
                  p.elements.push({
                    type: 'text', id: newElementId(),
                    x: 60, y: 400 + i * 50, w: 400, h: 40,
                    text: t, fontSize: 14, color: 'var(--theme-text-secondary)', align: 'center'
                  });
                }
              });
            }
            if (p.yearNum || p.yearLabel) {
              p.elements.push({
                type: 'text', id: newElementId(),
                x: 160, y: 80, w: 200, h: 70,
                text: String(p.yearNum || p.yearLabel),
                fontSize: 64, color: 'var(--theme-primary)', align: 'center',
                fontWeight: '700', opacity: 0.7
              });
            }
          }
          delete p.slots; delete p.texts; delete p.layout;
          delete p.yearNum; delete p.ageLabel; delete p.subtitle;
        }
      }
      state.theme = data.theme || 'warm';
      state.albumTitle = data.albumTitle || '成长纪念册';
      state.albumSubtitle = data.albumSubtitle || '记录每一个美好瞬间';
      state.coverPhoto = data.coverPhoto || null;
      state.frameStyle = data.frameStyle || 'clean';
      state.showDecorations = data.showDecorations !== false;
      setTheme(state.theme);
      if (state.rootDir) {
        $('#dir-path').textContent = state.rootDir;
        showLoading('正在重新扫描照片目录...');
        state.photoData = await API.scanPhotos(state.rootDir);
        renderYearNav();
        hideLoading();
      }
      updateSelectedCount();
      renderSelectedPanel();
      switchView('layout');
      showToast('项目已加载');
    } catch (e) {
      showToast('加载失败：文件格式错误');
    }
  });
  input.click();
});

// ==================== 导出 ====================
$('#btn-export').addEventListener('click', () => {
  if (state.albumPages.length === 0) {
    showToast('请先完成排版再导出');
    return;
  }
  $('#export-album-title').value = state.albumTitle;
  $('#export-modal').classList.remove('hidden');
});
$('#btn-export-cancel').addEventListener('click', () => {
  $('#export-modal').classList.add('hidden');
});
$('#export-modal .modal-overlay').addEventListener('click', () => {
  $('#export-modal').classList.add('hidden');
});
$('#btn-export-confirm').addEventListener('click', async () => {
  $('#export-modal').classList.add('hidden');
  const paperSize = $('#export-paper-size').value;
  const format = $('#export-format').value;
  const includeCover = $('#export-cover').checked;
  const albumTitle = $('#export-album-title').value || state.albumTitle;
  state.albumTitle = albumTitle;
  if (format === 'pdf') {
    await exportToPdf(paperSize, includeCover);
  } else {
    await exportToImages(paperSize, includeCover);
  }
});

async function exportToPdf(paperSize, includeCover) {
  showLoading('正在生成 PDF...');
  const { jsPDF } = window.jspdf;
  const sizes = {
    'a5': [148, 210], 'a4': [210, 297], 'a4-landscape': [297, 210],
    'a3': [297, 420], 'square': [210, 210], '8x10': [203, 254], '12x12': [305, 305]
  };
  const [pageW, pageH] = sizes[paperSize] || sizes['a5'];
  const pdf = new jsPDF({
    orientation: pageW > pageH ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [pageW, pageH]
  });
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-9999px;top:0;';
  document.body.appendChild(container);

  let pages = state.albumPages;
  if (includeCover) {
    const coverPage = createCoverPageData();
    pages = [coverPage, ...pages];
    const backPage = createBackCoverPageData();
    pages = [...pages, backPage];
  }

  for (let i = 0; i < pages.length; i++) {
    $('#loading-text').textContent = `渲染第 ${i+1}/${pages.length} 页...`;
    const page = pages[i];
    const pageEl = document.createElement('div');
    const renderW = 1200;
    const renderH = Math.round(renderW / (pageW / pageH));
    pageEl.style.width = renderW + 'px';
    pageEl.style.height = renderH + 'px';
    pageEl.style.position = 'relative';
    pageEl.style.overflow = 'hidden';
    pageEl.style.background = 'var(--theme-bg-page)';

    if (page.type === 'cover') {
      await renderCoverForExport(pageEl, page, renderW, renderH);
    } else if (page.type === 'back-cover') {
      renderBackCoverForExport(pageEl, renderW, renderH);
    } else {
      // 自由排版页面
      if (page.elements) {
        page.elements.forEach(el => {
          renderExportElement(pageEl, el, renderW / 620, renderH / Math.round(620 / 0.705));
        });
      }
    }

    container.appendChild(pageEl);
    await new Promise(r => setTimeout(r, 500));
    try {
      const canvas = await html2canvas(pageEl, {
        scale: 2, useCORS: true, allowTaint: true,
        backgroundColor: '#ffffff', logging: false
      });
      container.removeChild(pageEl);
      if (i > 0) pdf.addPage([pageW, pageH]);
      const imgData = canvas.toDataURL('image/jpeg', 0.9);
      pdf.addImage(imgData, 'JPEG', 0, 0, pageW, pageH, undefined, 'FAST');
    } catch (e) {
      if (pageEl.parentNode) container.removeChild(pageEl);
      console.error('渲染页面失败:', e);
    }
  }
  document.body.removeChild(container);
  const filename = state.albumTitle ? `${state.albumTitle}.pdf` : '相册.pdf';
  pdf.save(filename);
  hideLoading();
  showToast('PDF 已导出！');
}

function renderExportElement(pageEl, el, scaleX, scaleY) {
  const elDiv = document.createElement('div');
  elDiv.style.position = 'absolute';
  elDiv.style.left = (el.x * scaleX) + 'px';
  elDiv.style.top = (el.y * scaleY) + 'px';
  elDiv.style.width = (el.w * scaleX) + 'px';
  elDiv.style.height = (el.h * scaleY) + 'px';
  if (el.rotation) {
    elDiv.style.transform = `rotate(${el.rotation}deg)`;
    elDiv.style.transformOrigin = 'center center';
  }

  if (el.type === 'photo' && el.photo) {
    const img = document.createElement('img');
    img.src = API.fullImageUrl(el.photo.path);
    img.crossOrigin = 'anonymous';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
    const frame = el.frame || 'clean';
    if (frame === 'rounded') img.style.borderRadius = '16px';
    else if (frame === 'polaroid') {
      elDiv.style.padding = '12px 12px 36px 12px';
      elDiv.style.background = 'white';
      elDiv.style.boxShadow = '0 3px 10px rgba(0,0,0,0.1)';
      elDiv.style.borderRadius = '2px';
    } else if (frame === 'shadow') {
      img.style.boxShadow = '0 8px 24px rgba(0,0,0,0.15)';
    } else if (frame === 'vintage') {
      img.style.border = '6px solid #f0e6d3';
      img.style.padding = '3px';
      elDiv.style.background = '#fdf8f0';
    } else {
      img.style.border = '8px solid white';
      img.style.boxShadow = '0 3px 14px rgba(0,0,0,0.08)';
    }
    elDiv.appendChild(img);
    if (el.caption) {
      const cap = document.createElement('div');
      cap.style.cssText = 'position:absolute;bottom:0;left:0;right:0;padding:6px;background:rgba(255,255,255,0.9);font-size:12px;text-align:center;color:#666;';
      cap.textContent = el.caption;
      elDiv.appendChild(cap);
    }
  } else if (el.type === 'text') {
    const textDiv = document.createElement('div');
    textDiv.style.cssText = `
      width:100%;height:100%;
      font-size:${(el.fontSize || 16) * scaleX}px;
      color:${el.color || '#333'};
      text-align:${el.align || 'left'};
      font-weight:${el.fontWeight || 'normal'};
      font-style:${el.fontStyle || 'normal'};
      letter-spacing:${el.letterSpacing || 0}px;
      font-family:${el.fontFamily || 'Georgia,STSong,serif'};
      line-height:${el.lineHeight || 1.4};
      word-wrap:break-word;
    `;
    if (el.opacity) textDiv.style.opacity = el.opacity;
    textDiv.textContent = el.text || '';
    elDiv.appendChild(textDiv);
  } else if (el.type === 'decor') {
    if (el.subtype === 'emoji') {
      const span = document.createElement('span');
      span.textContent = el.emoji;
      span.style.cssText = `font-size:${(el.fontSize || 40) * scaleX}px;line-height:1;display:flex;align-items:center;justify-content:center;width:100%;height:100%;`;
      elDiv.appendChild(span);
    } else if (el.subtype === 'svg' || el.subtype === 'border') {
      const svgWrap = document.createElement('div');
      svgWrap.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';
      svgWrap.innerHTML = el.svgContent;
      elDiv.appendChild(svgWrap);
    }
  }
  pageEl.appendChild(elDiv);
}

async function exportToImages(paperSize, includeCover) {
  showLoading('正在逐页渲染...');
  const sizes = {
    'a5': [148, 210], 'a4': [210, 297], 'a4-landscape': [297, 210],
    'a3': [297, 420], 'square': [210, 210], '8x10': [203, 254], '12x12': [305, 305]
  };
  const [pageW, pageH] = sizes[paperSize] || sizes['a5'];
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-9999px;top:0;';
  document.body.appendChild(container);

  let pages = state.albumPages;
  if (includeCover) {
    const coverPage = createCoverPageData();
    pages = [coverPage, ...pages];
    const backPage = createBackCoverPageData();
    pages = [...pages, backPage];
  }

  for (let i = 0; i < pages.length; i++) {
    $('#loading-text').textContent = `渲染第 ${i+1}/${pages.length} 页...`;
    const page = pages[i];
    const pageEl = document.createElement('div');
    const renderW = 2480;
    const renderH = Math.round(renderW / (pageW / pageH));
    pageEl.style.width = renderW + 'px';
    pageEl.style.height = renderH + 'px';
    pageEl.style.position = 'relative';
    pageEl.style.overflow = 'hidden';
    pageEl.style.background = 'var(--theme-bg-page)';

    if (page.type === 'cover') {
      await renderCoverForExport(pageEl, page, renderW, renderH);
    } else if (page.type === 'back-cover') {
      renderBackCoverForExport(pageEl, renderW, renderH);
    } else {
      if (page.elements) {
        page.elements.forEach(el => {
          renderExportElement(pageEl, el, renderW / 620, renderH / Math.round(620 / 0.705));
        });
      }
    }

    container.appendChild(pageEl);
    await new Promise(r => setTimeout(r, 800));
    try {
      const canvas = await html2canvas(pageEl, {
        scale: 1, useCORS: true, allowTaint: true,
        backgroundColor: '#ffffff', logging: false
      });
      container.removeChild(pageEl);
      const link = document.createElement('a');
      link.download = `相册_第${String(i+1).padStart(3,'0')}页.jpg`;
      link.href = canvas.toDataURL('image/jpeg', 0.95);
      link.click();
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      if (pageEl.parentNode) container.removeChild(pageEl);
      console.error('渲染页面失败:', e);
    }
  }
  document.body.removeChild(container);
  hideLoading();
  showToast(`已导出 ${pages.length} 页高清图片`);
}

function createCoverPageData() {
  return {
    type: 'cover',
    title: state.albumTitle,
    subtitle: state.albumSubtitle,
    layout: 'full',
    slots: state.coverPhoto ? [{ photo: state.coverPhoto, caption: '' }] : []
  };
}
function createBackCoverPageData() {
  return {
    type: 'back-cover',
    title: state.albumTitle,
    layout: 'full',
    slots: []
  };
}

// 导出用：渲染封面
async function renderCoverForExport(pageEl, page, w, h) {
  pageEl.style.background = 'var(--theme-bg-page)';
  if (page.slots[0] && page.slots[0].photo) {
    const img = document.createElement('img');
    img.src = API.fullImageUrl(page.slots[0].photo.path);
    img.crossOrigin = 'anonymous';
    img.style.cssText = `width:${w}px;height:${h}px;object-fit:cover;position:absolute;top:0;left:0;`;
    pageEl.appendChild(img);
  }
  const overlay = document.createElement('div');
  overlay.style.cssText = `position:absolute;inset:0;
    background:linear-gradient(135deg,
      rgba(232,160,180,0.65) 0%,
      rgba(245,201,126,0.45) 100%);
    display:flex;flex-direction:column;align-items:center;justify-content:center;`;
  const title = document.createElement('div');
  title.style.cssText = `font-family:'Georgia','STSong',serif;font-size:56px;font-weight:700;
    color:white;text-shadow:0 3px 12px rgba(0,0,0,0.3);letter-spacing:6px;margin-bottom:16px;text-align:center;`;
  title.textContent = page.title || '成长纪念册';
  overlay.appendChild(title);
  const line = document.createElement('div');
  line.style.cssText = 'width:100px;height:2px;background:rgba(255,255,255,0.6);margin:8px 0;';
  overlay.appendChild(line);
  const subtitle = document.createElement('div');
  subtitle.style.cssText = `font-size:20px;color:rgba(255,255,255,0.9);
    text-shadow:0 1px 4px rgba(0,0,0,0.2);letter-spacing:3px;`;
  subtitle.textContent = page.subtitle || '';
  overlay.appendChild(subtitle);
  pageEl.appendChild(overlay);
}

// 导出用：渲染封底
function renderBackCoverForExport(pageEl, w, h) {
  pageEl.style.background = 'var(--theme-bg-page)';
  pageEl.style.display = 'flex';
  pageEl.style.alignItems = 'center';
  pageEl.style.justifyContent = 'center';
  pageEl.style.flexDirection = 'column';
  const bg = document.createElement('div');
  bg.style.cssText = `position:absolute;inset:0;
    background:radial-gradient(circle at center,var(--theme-primary-light) 0%,var(--theme-bg-page) 70%);`;
  pageEl.appendChild(bg);
  const text = document.createElement('div');
  text.style.cssText = `font-family:'Georgia','STSong',serif;font-size:22px;
    color:var(--theme-text-secondary);letter-spacing:3px;position:relative;z-index:1;`;
  text.textContent = '珍藏每一个美好瞬间';
  pageEl.appendChild(text);
  const year = document.createElement('div');
  year.style.cssText = `font-size:14px;color:var(--theme-text-lighter);margin-top:12px;position:relative;z-index:1;`;
  year.textContent = new Date().getFullYear() + ' 年';
  pageEl.appendChild(year);
}

// ==================== 右侧面板：页面导航 ====================
function renderPageNav() {
  const container = $('#page-nav-list');
  const countEl = $('#page-nav-count');
  container.innerHTML = '';
  
  if (state.albumPages.length === 0) {
    countEl.textContent = '';
    container.innerHTML = '<div style="text-align:center;color:#ccc;font-size:11px;padding:12px;">暂无页面</div>';
    return;
  }
  
  countEl.textContent = `${state.albumPages.length}`;
  
  state.albumPages.forEach((page, pageIndex) => {
    const item = document.createElement('div');
    item.className = 'page-nav-item';
    item.dataset.pageIndex = pageIndex;
    
    // 缩略图：显示页面第一张照片
    const thumb = document.createElement('div');
    thumb.className = 'page-nav-thumb';
    let firstPhoto = null;
    if (page.elements) {
      for (const el of page.elements) {
        if (el.type === 'photo' && el.photo) {
          firstPhoto = el.photo;
          break;
        }
      }
    }
    if (firstPhoto) {
      const img = document.createElement('img');
      img.src = API.thumbnailUrl(firstPhoto.path);
      thumb.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'thumb-placeholder';
      ph.textContent = '空';
      thumb.appendChild(ph);
    }
    item.appendChild(thumb);
    
    // 页码
    const num = document.createElement('div');
    num.className = 'page-nav-num';
    num.textContent = `P${pageIndex + 1}`;
    item.appendChild(num);
    
    container.appendChild(item);
  });
  
  // 监听滚动高亮当前页
  updateActivePageNav();
}

function scrollToPage(pageIndex) {
  // 切换到指定页面
  editingPageIndex = pageIndex;
  renderAlbumPages();
  renderPageNav();
  updateActivePageNav();
  updatePagePropsPanel();
}

function updateActivePageNav() {
  const currentIdx = editingPageIndex;
  $$('.page-nav-item').forEach(item => {
    item.classList.toggle('active', parseInt(item.dataset.pageIndex) === currentIdx);
  });
  
  // 左侧缩略图导航：自动滚动到当前高亮的项
  const activeNav = document.querySelector('.layout-thumbnails .page-nav-item.active');
  if (activeNav) {
    activeNav.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// 左侧缩略图导航容器滚动（独立滚动区域，不冒泡）
document.querySelector('.layout-thumbnails')?.addEventListener('scroll', (e) => {
  e.stopPropagation();
}, true);

// ==================== 右侧面板：未使用素材 ====================
function getUnusedPhotos() {
  // 收集排版中已使用的照片路径
  const usedPaths = new Set();
  state.albumPages.forEach(page => {
    if (page.elements) {
      page.elements.forEach(el => {
        if (el.type === 'photo' && el.photo) {
          usedPaths.add(el.photo.path);
        }
      });
    }
  });
  
  // 精选但未使用的照片
  const unused = [];
  for (const [path, photo] of state.selectedPhotos) {
    if (!usedPaths.has(path)) {
      unused.push(photo);
    }
  }
  return unused;
}

function renderUnusedPhotos() {
  const container = $('#unused-photos');
  const countEl = $('#unused-count');
  container.innerHTML = '';
  
  const unused = getUnusedPhotos();
  countEl.textContent = unused.length > 0 ? `${unused.length}张` : '';
  
  // 素材区作为 drop zone：接收从页面拖回的照片
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    container.classList.add('unused-drag-over');
  });
  container.addEventListener('dragleave', () => {
    container.classList.remove('unused-drag-over');
  });
  container.addEventListener('drop', (e) => {
    e.preventDefault();
    container.classList.remove('unused-drag-over');
    handleDropOnUnused(e);
  });
  
  if (unused.length === 0) {
    container.innerHTML = '<div class="unused-empty">全部素材已排版 ✓<br><small style="font-size:10px;">可将页面照片拖回此处</small></div>';
    return;
  }
  
  unused.forEach(photo => {
    const item = document.createElement('div');
    item.className = 'unused-photo-item';
    item.draggable = true;
    item.dataset.photoPath = photo.path;
    const img = document.createElement('img');
    img.src = API.thumbnailUrl(photo.path);
    img.loading = 'lazy';
    img.draggable = false; // 阻止图片默认拖拽
    item.appendChild(img);

    const hint = document.createElement('div');
    hint.className = 'unused-hint';
    hint.textContent = '拖拽或点击';
    item.appendChild(hint);

    // 拖拽开始：设置拖拽数据
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/photo-path', photo.path);
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
    });

    // 点击仍然可以添加
    item.addEventListener('click', () => {
      addUnusedPhotoToAlbum(photo);
    });

    container.appendChild(item);
  });
}

function addUnusedPhotoToAlbum(photo) {
  if (state.albumPages.length === 0) return;

  // 找到当前视口中最接近的页面
  let targetIndex = state.albumPages.length - 1;
  const mainArea = document.querySelector('.layout-main');
  if (mainArea) {
    let minDist = Infinity;
    const centerY = mainArea.scrollTop + mainArea.clientHeight / 2;
    $$('.album-page').forEach(pageEl => {
      const rect = pageEl.getBoundingClientRect();
      const mainRect = mainArea.getBoundingClientRect();
      const pageCenter = rect.top - mainRect.top + mainArea.scrollTop + rect.height / 2;
      const dist = Math.abs(pageCenter - centerY);
      if (dist < minDist) {
        minDist = dist;
        targetIndex = parseInt(pageEl.dataset.pageIndex);
      }
    });
  }

  const page = state.albumPages[targetIndex];
  if (!page.elements) page.elements = [];

  // 计算页面剩余空间，智能决定是放入当前页还是新建页面
  const pw = 620, ph = Math.round(620 / 0.705);
  const margin = 30;
  const photoW = 200, photoH = 200;

  // 查找可用空位（简单网格扫描）
  function findFreeRect(w, h) {
    const occupied = page.elements
      .filter(e => e.type === 'photo' && e.photo)
      .map(e => ({ x: e.x, y: e.y, w: e.w, h: e.h }));

    // 尝试几个预设位置
    const candidates = [
      { x: margin, y: margin },
      { x: pw - margin - w, y: margin },
      { x: margin, y: ph - margin - h },
      { x: pw - margin - w, y: ph - margin - h },
      { x: (pw - w) / 2, y: margin },
      { x: margin, y: (ph - h) / 2 },
      { x: (pw - w) / 2, y: (ph - h) / 2 },
    ];

    for (const pos of candidates) {
      const rect = { x: pos.x, y: pos.y, w, h };
      if (rect.x < margin || rect.y < margin) continue;
      if (rect.x + rect.w > pw - margin) continue;
      if (rect.y + rect.h > ph - margin) continue;
      const overlap = occupied.some(o =>
        rect.x < o.x + o.w + 10 && rect.x + rect.w + 10 > o.x &&
        rect.y < o.y + o.h + 10 && rect.y + rect.h + 10 > o.y
      );
      if (!overlap) return rect;
    }
    return null;
  }

  let pos = findFreeRect(photoW, photoH);

  // 如果当前页没有空位，自动创建新页面
  if (!pos) {
    targetIndex = targetIndex + 1;
    const newPage = {
      type: 'free',
      yearLabel: page.yearLabel || '',
      elements: []
    };
    state.albumPages.splice(targetIndex, 0, newPage);
    pos = { x: margin, y: margin };
  }

  const targetPage = state.albumPages[targetIndex];
  if (!targetPage.elements) targetPage.elements = [];

  targetPage.elements.push({
    type: 'photo', id: newElementId(),
    x: Math.round(pos.x), y: Math.round(pos.y),
    w: photoW, h: photoH,
    photo, caption: '', frame: state.frameStyle
  });

  editingPageIndex = targetIndex;
  renderAlbumPages();
  showToast(`已将 "${photo.name}" 添加到第${targetIndex + 1}页`);
}

// ==================== 拖拽处理函数 ====================

// 从页面移除元素（照片元素退回素材库）
function removeElementFromPage(page, el) {
  page.elements = page.elements.filter(e => e.id !== el.id);
}

// 处理拖拽放置到页面
function handleDropOnPage(e, page, pageIndex) {
  const photoPath = e.dataTransfer.getData('application/photo-path');
  const elementId = e.dataTransfer.getData('application/element-id');
  const fromPageIndex = e.dataTransfer.getData('application/page-index');

  // 情况1：从素材库拖来
  if (photoPath && !elementId) {
    // 从 selectedPhotos 中找到对应照片
    const photo = [...state.selectedPhotos.values()].find(p => p.path === photoPath);
    if (!photo) return;
    // 添加到目标页面
    addPhotoToPage(page, photo, e, pageIndex);
    return;
  }

  // 情况2：从其他页面拖来（移动元素到不同页面）
  if (elementId && fromPageIndex !== undefined && fromPageIndex !== String(pageIndex)) {
    const fromPage = state.albumPages[parseInt(fromPageIndex)];
    const elIdx = fromPage.elements.findIndex(e => e.id === elementId);
    if (elIdx < 0) return;
    const [el] = fromPage.elements.splice(elIdx, 1);
    if (!page.elements) page.elements = [];
    // 计算放置位置
    const pageRect = e.target.closest('.album-page').getBoundingClientRect();
    el.x = Math.round(e.clientX - pageRect.left - el.w / 2);
    el.y = Math.round(e.clientY - pageRect.top - el.h / 2);
    el.x = Math.max(0, Math.min(el.x, 620 - el.w));
    el.y = Math.max(0, Math.min(el.y, Math.round(620 / 0.705) - el.h));
    page.elements.push(el);
    renderAlbumPages();
    return;
  }

  // 情况3：同页面内拖拽移动位置
  if (elementId && fromPageIndex !== undefined && fromPageIndex === String(pageIndex)) {
    const el = page.elements.find(e => e.id === elementId);
    if (!el) return;
    // 计算新位置
    const pageRect = e.target.closest('.album-page').getBoundingClientRect();
    el.x = Math.round(e.clientX - pageRect.left - el.w / 2);
    el.y = Math.round(e.clientY - pageRect.top - el.h / 2);
    el.x = Math.max(0, Math.min(el.x, 620 - el.w));
    el.y = Math.max(0, Math.min(el.y, Math.round(620 / 0.705) - el.h));
    renderAlbumPages();
    return;
  }
}

// 处理拖拽放置到素材区（从页面退回）
function handleDropOnUnused(e) {
  const elementId = e.dataTransfer.getData('application/element-id');
  const pageIndex = e.dataTransfer.getData('application/page-index');
  if (!elementId || pageIndex === undefined) return;
  const page = state.albumPages[parseInt(pageIndex)];
  if (!page || !page.elements) return;
  const el = page.elements.find(el => el.id === elementId);
  if (!el || el.type !== 'photo' || !el.photo) return;
  // 从页面移除，照片回到素材库（自动由 getUnusedPhotos 计算）
  removeElementFromPage(page, el);
  if (state.selectedElement && state.selectedElement.el.id === el.id) {
    state.selectedElement = null;
    hideTextPropsBar();
  }
  renderAlbumPages();
  showToast(`已将 "${el.photo.name}" 退回素材库`);
}

// 添加照片到指定页面（拖拽版本，使用鼠标位置计算坐标）
function addPhotoToPage(page, photo, dropEvent, pageIndex) {
  if (!page.elements) page.elements = [];
  const pageEl = dropEvent.target.closest('.album-page');
  if (!pageEl) return;
  const pageRect = pageEl.getBoundingClientRect();
  const x = Math.round(dropEvent.clientX - pageRect.left - 100);
  const y = Math.round(dropEvent.clientY - pageRect.top - 100);
  const clampedX = Math.max(0, Math.min(x, 620 - 200));
  const clampedY = Math.max(0, Math.min(y, Math.round(620 / 0.705) - 200));
  page.elements.push({
    type: 'photo', id: newElementId(),
    x: clampedX, y: clampedY,
    w: 200, h: 200,
    photo, caption: '', frame: state.frameStyle
  });
  editingPageIndex = pageIndex;
  renderAlbumPages();
  showToast(`已将 "${photo.name}" 拖入第${pageIndex + 1}页`);
}

// ==================== 右侧面板：页面属性 ====================
// 当前选中的页面索引（用于属性编辑）
let editingPageIndex = null;

// 模板配置：每个模板需要的最大照片数
const TEMPLATE_CONFIG = {
  1: { maxPhotos: 1, name: '单张大图' },
  2: { maxPhotos: 2, name: '左右双图' },
  3: { maxPhotos: 3, name: '上大下双' },
  4: { maxPhotos: 4, name: '四宫格' },
  5: { maxPhotos: 3, name: '左大右双' },
  6: { maxPhotos: 3, name: '三图横排' }
};

// 页面背景色切换
$$('#page-bg-colors .bg-color-dot').forEach(dot => {
  dot.addEventListener('click', () => {
    if (editingPageIndex === null || editingPageIndex >= state.albumPages.length) {
      showToast('请先在页面导航中选择一个页面');
      return;
    }
    const bgColor = dot.dataset.bg;
    const page = state.albumPages[editingPageIndex];
    page.bgColor = bgColor;
    // 更新高亮
    $$('#page-bg-colors .bg-color-dot').forEach(d => d.classList.remove('active'));
    dot.classList.add('active');
    renderAlbumPages();
  });
});

// 快速模板应用
$$('#quick-templates .tpl-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // 自动选择当前可视页面（如果没有手动选择）
    let targetIndex = editingPageIndex;
    if (targetIndex === null || targetIndex >= state.albumPages.length) {
      const mainArea = document.querySelector('.layout-main');
      if (mainArea && state.albumPages.length > 0) {
        let minDist = Infinity;
        const centerY = mainArea.scrollTop + mainArea.clientHeight / 2;
        $$('.album-page').forEach(pageEl => {
          const rect = pageEl.getBoundingClientRect();
          const mainRect = mainArea.getBoundingClientRect();
          const pageCenter = rect.top - mainRect.top + mainArea.scrollTop + rect.height / 2;
          const dist = Math.abs(pageCenter - centerY);
          if (dist < minDist) { minDist = dist; targetIndex = parseInt(pageEl.dataset.pageIndex); }
        });
      }
    }
    if (targetIndex === null || targetIndex >= state.albumPages.length) {
      showToast('请先在页面导航中选择一个页面');
      return;
    }
    editingPageIndex = targetIndex;
    // 高亮导航项
    $$('.page-nav-item').forEach(item => item.classList.remove('active'));
    const navItem = document.querySelector(`.page-nav-item[data-page-index="${targetIndex}"]`);
    if (navItem) navItem.classList.add('active');

    const tpl = parseInt(btn.dataset.tpl);
    const page = state.albumPages[targetIndex];
    if (!page.elements) page.elements = [];
    pushUndoState();

    // 收集当前页面的照片元素（保留照片引用）
    const existingPhotos = page.elements.filter(e => e.type === 'photo' && e.photo).map(e => e.photo);
    const existingTexts = page.elements.filter(e => e.type === 'text');
    const existingDecors = page.elements.filter(e => e.type === 'decor');

    // 如果当前页面照片不够，自动从未使用照片中补充
    const needed = TEMPLATE_CONFIG[tpl].maxPhotos;
    while (existingPhotos.length < needed && state.unusedPhotos && state.unusedPhotos.length > 0) {
      existingPhotos.push(state.unusedPhotos.shift());
    }

    // 如果 still 不够，从所有已选照片中补充（排除已在页面中的）
    if (existingPhotos.length === 0) {
      const allSelected = [...state.selectedPhotos.values()];
      const usedPaths = new Set();
      state.albumPages.forEach(p => {
        if (p.elements) {
          p.elements.forEach(e => { if (e.type === 'photo' && e.photo) usedPaths.add(e.photo.path); });
        }
      });
      const available = allSelected.filter(p => !usedPaths.has(p.path));
      if (available.length > 0) {
        existingPhotos.push(...available.slice(0, needed));
      }
    }

    if (existingPhotos.length === 0) {
      showToast('没有可用照片，请先在选片视图中精选照片');
      return;
    }

    // 清空并重新布局（保留文字和装饰）
    page.elements = [...existingTexts, ...existingDecors];

    const pw = 620, ph = Math.round(620 / 0.705);
    const photos = existingPhotos;

    if (tpl === 1) {
      // 单张大图
      page.elements.push({
        type: 'photo', id: newElementId(),
        x: 40, y: 50, w: pw - 80, h: ph - 100,
        photo: photos[0], caption: '', frame: state.frameStyle
      });
    } else if (tpl === 2) {
      // 左右双图
      const gap = 16, margin = 30;
      const w = Math.floor((pw - margin * 2 - gap) / 2);
      const h = ph - 100;
      for (let i = 0; i < Math.min(2, photos.length); i++) {
        page.elements.push({
          type: 'photo', id: newElementId(),
          x: margin + i * (w + gap), y: 50, w, h,
          photo: photos[i], caption: '', frame: state.frameStyle
        });
      }
    } else if (tpl === 3) {
      // 上大下双
      const gap = 14, margin = 30;
      const topH = Math.round((ph - 90) * 0.58);
      const bottomH = ph - 90 - topH - gap;
      const bottomW = Math.floor((pw - margin * 2 - gap) / 2);
      page.elements.push({
        type: 'photo', id: newElementId(),
        x: margin, y: 40, w: pw - margin * 2, h: topH,
        photo: photos[0], caption: '', frame: state.frameStyle
      });
      for (let i = 1; i < Math.min(3, photos.length); i++) {
        page.elements.push({
          type: 'photo', id: newElementId(),
          x: margin + (i - 1) * (bottomW + gap), y: 40 + topH + gap,
          w: bottomW, h: bottomH,
          photo: photos[i], caption: '', frame: state.frameStyle
        });
      }
    } else if (tpl === 4) {
      // 四宫格
      const gap = 14, margin = 30;
      const w = Math.floor((pw - margin * 2 - gap) / 2);
      const h = Math.floor((ph - 90 - gap) / 2);
      for (let i = 0; i < Math.min(4, photos.length); i++) {
        page.elements.push({
          type: 'photo', id: newElementId(),
          x: margin + (i % 2) * (w + gap), y: 40 + Math.floor(i / 2) * (h + gap),
          w, h,
          photo: photos[i], caption: '', frame: state.frameStyle
        });
      }
    } else if (tpl === 5) {
      // 左大右双
      const gap = 14, margin = 30;
      const leftW = Math.round((pw - margin * 2 - gap) * 0.55);
      const rightH = Math.floor((ph - 90 - gap) / 2);
      const rightW = pw - margin * 2 - leftW - gap;
      page.elements.push({
        type: 'photo', id: newElementId(),
        x: margin, y: 45, w: leftW, h: ph - 90,
        photo: photos[0], caption: '', frame: state.frameStyle
      });
      for (let i = 1; i < Math.min(3, photos.length); i++) {
        page.elements.push({
          type: 'photo', id: newElementId(),
          x: margin + leftW + gap, y: 45 + (i - 1) * (rightH + gap),
          w: rightW, h: rightH,
          photo: photos[i], caption: '', frame: state.frameStyle
        });
      }
    } else if (tpl === 6) {
      // 三图横排
      const gap = 14, margin = 30;
      const w = Math.floor((pw - margin * 2 - gap * 2) / 3);
      const h = ph - 100;
      for (let i = 0; i < Math.min(3, photos.length); i++) {
        page.elements.push({
          type: 'photo', id: newElementId(),
          x: margin + i * (w + gap), y: 50, w, h,
          photo: photos[i], caption: '', frame: state.frameStyle
        });
      }
    }

    // 高亮模板按钮
    $$('#quick-templates .tpl-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    renderAlbumPages();
    renderUnusedPhotos();
    showToast(`模板「${btn.title}」已应用到第${targetIndex + 1}页`);
  });
});

// 点击页面导航项时设置编辑页面
document.addEventListener('click', (e) => {
  const navItem = e.target.closest('.page-nav-item');
  if (navItem) {
    const pageIndex = parseInt(navItem.dataset.pageIndex);
    if (pageIndex !== editingPageIndex) {
      editingPageIndex = pageIndex;
      renderAlbumPages();
      renderPageNav();
      updateActivePageNav();
      updatePagePropsPanel();
    }
  }
});

function updatePagePropsPanel() {
  if (editingPageIndex === null || editingPageIndex >= state.albumPages.length) return;
  const page = state.albumPages[editingPageIndex];
  
  // 背景色高亮
  $$('#page-bg-colors .bg-color-dot').forEach(d => {
    d.classList.toggle('active', d.dataset.bg === (page.bgColor || '#FFFEFB'));
  });
}

// ==================== 装饰素材库 ====================

// Emoji 素材（按分类）
const DECOR_EMOJI = {
  '🌸 花朵': ['🌸','🌺','🌻','🌹','🌷','🌼','💐','🪷','🥀','💮','🏵️','🌾','🌿','🍀','☘️','🍃','🌱','🪴'],
  '🐾 动物': ['🐶','🐱','🐰','🐻','🐼','🐨','🐯','🦊','🐸','🐣','🐥','🦋','🐞','🐝','🐌','🦄','🐙','🐠'],
  '⭐ 星星': ['⭐','🌟','✨','💫','🌠','🔆','💥','🎇','🎆','🔥','☀️','🌈','☁️','❄️','💧','🫧'],
  '❤️ 爱心': ['❤️','🧡','💛','💚','💙','💜','🤎','🖤','🤍','💕','💗','💖','💝','💘','💓','💞','♥️','🩷'],
  '🎀 装饰': ['🎀','🎁','🎈','🎊','🎉','🏆','👑','💎','🔔','🎵','🎶','📷','🕊️','🪶','🧸','🫧'],
  '📅 标记': ['📍','📌','📎','🖇️','✂️','📏','🖊️','✏️','📝','🗒️','📅','🕐','📖','🔖','🏷️'],
  '🍰 美食': ['🍰','🧁','🍩','🍪','🎂','🍭','🍬','🍫','🍦','🍓','🍒','🍑','🍊','🍋','🥑'],
  '✿ 符号': ['♪','♫','☮','✿','❀','✾','❁','⚘','❋','✦','✧','◈','◆','◇','❖','➤','∞','∴']
};

// SVG 装饰定义
const DECOR_SVG = [
  { name: '粉色小花', svg: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="14" fill="#FFB7B2"/><circle cx="35" cy="38" r="12" fill="#FF9AA2"/><circle cx="65" cy="38" r="12" fill="#FF9AA2"/><circle cx="35" cy="62" r="12" fill="#FF9AA2"/><circle cx="65" cy="62" r="12" fill="#FF9AA2"/><circle cx="50" cy="50" r="8" fill="#FFDAC1"/></svg>' },
  { name: '金色星星', svg: '<svg viewBox="0 0 100 100"><polygon points="50,5 61,35 94,35 68,57 79,91 50,70 21,91 32,57 6,35 39,35" fill="#F5C97E" stroke="#E8A840" stroke-width="1.5"/></svg>' },
  { name: '爱心', svg: '<svg viewBox="0 0 100 100"><path d="M50 85 C20 60, 0 45, 0 28 C0 14, 14 5, 28 5 C38 5, 46 12, 50 20 C54 12, 62 5, 72 5 C86 5, 100 14, 100 28 C100 45, 80 60, 50 85Z" fill="#FF6B6B"/></svg>' },
  { name: '绿色四叶草', svg: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="10" fill="#7FB069"/><circle cx="35" cy="38" r="14" fill="#A3C9A8"/><circle cx="65" cy="38" r="14" fill="#A3C9A8"/><circle cx="35" cy="62" r="14" fill="#A3C9A8"/><circle cx="65" cy="62" r="14" fill="#A3C9A8"/><rect x="47" y="55" width="6" height="30" rx="3" fill="#7FB069"/></svg>' },
  { name: '蓝色水滴', svg: '<svg viewBox="0 0 100 100"><path d="M50 10 C50 10, 20 50, 20 68 C20 84, 33 95, 50 95 C67 95, 80 84, 80 68 C80 50, 50 10, 50 10Z" fill="#8BB8D6" opacity="0.85"/><ellipse cx="40" cy="60" rx="6" ry="10" fill="white" opacity="0.4" transform="rotate(-20 40 60)"/></svg>' },
  { name: '圆点花环', svg: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="#E8A0B4" stroke-width="1.5" stroke-dasharray="4,6"/><circle cx="50" cy="50" r="32" fill="none" stroke="#F5C97E" stroke-width="1" stroke-dasharray="3,7"/><circle cx="50" cy="15" r="6" fill="#FFB7B2"/><circle cx="76" cy="28" r="5" fill="#FFDAC1"/><circle cx="82" cy="55" r="5" fill="#A3C9A8"/><circle cx="72" cy="78" r="6" fill="#8BB8D6"/><circle cx="50" cy="85" r="5" fill="#F5C97E"/><circle cx="28" cy="78" r="5" fill="#E8A0B4"/><circle cx="18" cy="55" r="6" fill="#FFB7B2"/><circle cx="24" cy="28" r="5" fill="#C5E0C8"/></svg>' },
  { name: '蝴蝶', svg: '<svg viewBox="0 0 100 100"><ellipse cx="35" cy="40" rx="18" ry="12" fill="#F4B5C2" opacity="0.8" transform="rotate(-15 35 40)"/><ellipse cx="65" cy="40" rx="18" ry="12" fill="#F4B5C2" opacity="0.8" transform="rotate(15 65 40)"/><ellipse cx="35" cy="58" rx="12" ry="9" fill="#FAD1D8" opacity="0.8" transform="rotate(-10 35 58)"/><ellipse cx="65" cy="58" rx="12" ry="9" fill="#FAD1D8" opacity="0.8" transform="rotate(10 65 58)"/><rect x="48" y="30" width="4" height="40" rx="2" fill="#8B7355"/><line x1="50" y1="25" x2="38" y2="18" stroke="#8B7355" stroke-width="2"/><line x1="50" y1="25" x2="62" y2="18" stroke="#8B7355" stroke-width="2"/><circle cx="38" cy="18" r="3" fill="#E8A0B4"/><circle cx="62" cy="18" r="3" fill="#E8A0B4"/></svg>' },
  { name: '月亮', svg: '<svg viewBox="0 0 100 100"><path d="M60 10 C45 10, 30 25, 30 50 C30 75, 45 90, 60 90 C50 78, 45 65, 45 50 C45 35, 50 22, 60 10Z" fill="#F5C97E"/></svg>' },
  { name: '云朵', svg: '<svg viewBox="0 0 100 100"><circle cx="30" cy="55" r="18" fill="white" opacity="0.9"/><circle cx="48" cy="45" r="24" fill="white" opacity="0.9"/><circle cx="68" cy="52" r="20" fill="white" opacity="0.9"/><circle cx="82" cy="58" r="14" fill="white" opacity="0.9"/><rect x="25" y="56" width="60" height="22" rx="11" fill="white" opacity="0.9"/></svg>' },
  { name: '太阳', svg: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="20" fill="#F5C97E"/><line x1="50" y1="18" x2="50" y2="8" stroke="#F5C97E" stroke-width="3" stroke-linecap="round"/><line x1="50" y1="82" x2="50" y2="92" stroke="#F5C97E" stroke-width="3" stroke-linecap="round"/><line x1="18" y1="50" x2="8" y2="50" stroke="#F5C97E" stroke-width="3" stroke-linecap="round"/><line x1="82" y1="50" x2="92" y2="50" stroke="#F5C97E" stroke-width="3" stroke-linecap="round"/><line x1="27" y1="27" x2="20" y2="20" stroke="#F5C97E" stroke-width="3" stroke-linecap="round"/><line x1="73" y1="73" x2="80" y2="80" stroke="#F5C97E" stroke-width="3" stroke-linecap="round"/><line x1="73" y1="27" x2="80" y2="20" stroke="#F5C97E" stroke-width="3" stroke-linecap="round"/><line x1="27" y1="73" x2="20" y2="80" stroke="#F5C97E" stroke-width="3" stroke-linecap="round"/></svg>' },
  { name: '钻石', svg: '<svg viewBox="0 0 100 100"><polygon points="50,8 85,40 50,92 15,40" fill="#C5E0C8" stroke="#A3C9A8" stroke-width="2"/><polygon points="50,8 50,50 85,40" fill="white" opacity="0.3"/><polygon points="50,50 85,40 50,92" fill="#7FB085" opacity="0.4"/></svg>' },
  { name: '羽毛', svg: '<svg viewBox="0 0 100 100"><path d="M20 80 Q35 50, 50 30 Q55 15, 70 10 Q60 30, 80 50 Q70 35, 55 45 Q50 55, 45 70 Q50 55, 40 40 Q35 55, 20 80Z" fill="#FAD1D8" stroke="#E8A0B4" stroke-width="1"/><line x1="20" y1="80" x2="70" y2="10" stroke="#D4889A" stroke-width="2"/></svg>' },
  { name: '音符', svg: '<svg viewBox="0 0 100 100"><circle cx="30" cy="70" r="10" fill="#8BB8D6"/><circle cx="65" cy="45" r="10" fill="#A8D8EA"/><line x1="40" y1="70" x2="75" y2="45" stroke="#6A9FC0" stroke-width="3"/><line x1="40" y1="70" x2="40" y2="20" stroke="#6A9FC0" stroke-width="3"/><line x1="75" y1="45" x2="75" y2="15" stroke="#6A9FC0" stroke-width="3"/><path d="M40 20 Q55 15, 55 25" fill="none" stroke="#6A9FC0" stroke-width="2"/><path d="M75 15 Q90 10, 90 20" fill="none" stroke="#6A9FC0" stroke-width="2"/></svg>' },
  { name: '气球', svg: '<svg viewBox="0 0 100 100"><ellipse cx="50" cy="42" rx="22" ry="28" fill="#F4B5C2"/><ellipse cx="38" cy="35" rx="6" ry="8" fill="white" opacity="0.4" transform="rotate(-20 38 35)"/><polygon points="50,70 46,72 54,72" fill="#E894A6"/><path d="M50 72 Q48 80, 45 85" fill="none" stroke="#999" stroke-width="1.5"/><ellipse cx="18" cy="25" rx="16" ry="20" fill="#A8D8EA"/><ellipse cx="12" cy="20" rx="4" ry="6" fill="white" opacity="0.4"/><polygon points="18,45 15,47 21,47" fill="#8BB8D6"/><path d="M18 47 Q16 52, 14 55" fill="none" stroke="#999" stroke-width="1.5"/></svg>' },
  { name: '彩虹', svg: '<svg viewBox="0 0 100 100"><path d="M10 80 Q50 -10, 90 80" fill="none" stroke="#FF6B6B" stroke-width="6" opacity="0.7"/><path d="M16 80 Q50 0, 84 80" fill="none" stroke="#F5C97E" stroke-width="6" opacity="0.7"/><path d="M22 80 Q50 10, 78 80" fill="none" stroke="#A3C9A8" stroke-width="6" opacity="0.7"/><path d="M28 80 Q50 20, 72 80" fill="none" stroke="#8BB8D6" stroke-width="6" opacity="0.7"/><path d="M34 80 Q50 30, 66 80" fill="none" stroke="#E8A0B4" stroke-width="6" opacity="0.7"/></svg>' },
];

// 花边边框定义
const DECOR_BORDERS = [
  { name: '圆点花边', svg: '<svg viewBox="0 0 200 60"><rect x="5" y="5" width="190" height="50" rx="8" fill="none" stroke="#E8A0B4" stroke-width="2" stroke-dasharray="2,6" stroke-linecap="round"/><circle cx="20" cy="30" r="4" fill="#FFB7B2"/><circle cx="60" cy="30" r="4" fill="#FFDAC1"/><circle cx="100" cy="30" r="4" fill="#A3C9A8"/><circle cx="140" cy="30" r="4" fill="#8BB8D6"/><circle cx="180" cy="30" r="4" fill="#F5C97E"/></svg>' },
  { name: '波浪边框', svg: '<svg viewBox="0 0 200 60"><rect x="5" y="5" width="190" height="50" rx="6" fill="none" stroke="#8BB8D6" stroke-width="2"/><path d="M10 30 Q30 18, 50 30 Q70 42, 90 30 Q110 18, 130 30 Q150 42, 170 30 Q190 18, 195 30" fill="none" stroke="#A8D8EA" stroke-width="1.5"/></svg>' },
  { name: '藤蔓花边', svg: '<svg viewBox="0 0 200 60"><rect x="5" y="5" width="190" height="50" rx="6" fill="none" stroke="#A3C9A8" stroke-width="2"/><path d="M15 30 Q30 20, 40 30 Q55 18, 65 30 Q80 20, 90 30 Q105 18, 115 30 Q130 20, 140 30 Q155 18, 165 30 Q180 20, 190 30" fill="none" stroke="#7FB069" stroke-width="1.5"/><circle cx="30" cy="24" r="3" fill="#C5E0C8"/><circle cx="65" cy="22" r="3" fill="#C5E0C8"/><circle cx="100" cy="24" r="3" fill="#C5E0C8"/><circle cx="135" cy="22" r="3" fill="#C5E0C8"/><circle cx="170" cy="24" r="3" fill="#C5E0C8"/></svg>' },
  { name: '爱心花边', svg: '<svg viewBox="0 0 200 60"><rect x="5" y="5" width="190" height="50" rx="6" fill="none" stroke="#F4B5C2" stroke-width="2"/><path d="M40 30 C40 26, 36 22, 32 26 C28 30, 40 38, 40 38 C40 38, 52 30, 48 26 C44 22, 40 26, 40 30Z" fill="#FFB7B2" opacity="0.6" transform="translate(0,-6) scale(0.8)"/><path d="M90 30 C90 26, 86 22, 82 26 C78 30, 90 38, 90 38 C90 38, 102 30, 98 26 C94 22, 90 26, 90 30Z" fill="#FFB7B2" opacity="0.6" transform="translate(0,-6) scale(0.8)"/><path d="M140 30 C140 26, 136 22, 132 26 C128 30, 140 38, 140 38 C140 38, 152 30, 148 26 C144 22, 140 26, 140 30Z" fill="#FFB7B2" opacity="0.6" transform="translate(0,-6) scale(0.8)"/></svg>' },
  { name: '星点花边', svg: '<svg viewBox="0 0 200 60"><rect x="5" y="5" width="190" height="50" rx="6" fill="none" stroke="#F5C97E" stroke-width="2"/><polygon points="40,20 42,26 48,26 43,30 45,36 40,32 35,36 37,30 32,26 38,26" fill="#F5C97E" opacity="0.5"/><polygon points="100,20 102,26 108,26 103,30 105,36 100,32 95,36 97,30 92,26 98,26" fill="#F5C97E" opacity="0.5"/><polygon points="160,20 162,26 168,26 163,30 165,36 160,32 155,36 157,30 152,26 158,26" fill="#F5C97E" opacity="0.5"/></svg>' },
  { name: '双层边框', svg: '<svg viewBox="0 0 200 60"><rect x="8" y="8" width="184" height="44" rx="4" fill="none" stroke="#E8A0B4" stroke-width="1"/><rect x="4" y="4" width="192" height="52" rx="6" fill="none" stroke="#D4889A" stroke-width="1.5"/><circle cx="18" cy="30" r="2" fill="#F5C97E"/><circle cx="182" cy="30" r="2" fill="#F5C97E"/></svg>' },
  { name: '虚线边框', svg: '<svg viewBox="0 0 200 60"><rect x="5" y="5" width="190" height="50" rx="4" fill="none" stroke="#C4A882" stroke-width="1.5" stroke-dasharray="8,4"/><rect x="12" y="12" width="176" height="36" rx="3" fill="none" stroke="#D4B896" stroke-width="1" stroke-dasharray="4,4"/></svg>' },
  { name: '蕾丝花边', svg: '<svg viewBox="0 0 200 60"><rect x="5" y="5" width="190" height="50" rx="6" fill="none" stroke="#FAD1D8" stroke-width="2"/><circle cx="30" cy="10" r="5" fill="none" stroke="#F4B5C2" stroke-width="1.5"/><circle cx="70" cy="10" r="5" fill="none" stroke="#F4B5C2" stroke-width="1.5"/><circle cx="110" cy="10" r="5" fill="none" stroke="#F4B5C2" stroke-width="1.5"/><circle cx="150" cy="10" r="5" fill="none" stroke="#F4B5C2" stroke-width="1.5"/><circle cx="190" cy="10" r="5" fill="none" stroke="#F4B5C2" stroke-width="1.5"/><circle cx="50" cy="50" r="5" fill="none" stroke="#F4B5C2" stroke-width="1.5"/><circle cx="90" cy="50" r="5" fill="none" stroke="#F4B5C2" stroke-width="1.5"/><circle cx="130" cy="50" r="5" fill="none" stroke="#F4B5C2" stroke-width="1.5"/><circle cx="170" cy="50" r="5" fill="none" stroke="#F4B5C2" stroke-width="1.5"/></svg>' },
];

// 渲染装饰素材面板
function renderDecorPanels() {
  // Emoji 面板
  const emojiPanel = $('#decor-emoji-panel');
  emojiPanel.innerHTML = '';
  for (const [category, emojis] of Object.entries(DECOR_EMOJI)) {
    const label = document.createElement('div');
    label.className = 'decor-cat-label';
    label.textContent = category;
    emojiPanel.appendChild(label);
    emojis.forEach(emoji => {
      const item = document.createElement('div');
      item.className = 'decor-item';
      item.textContent = emoji;
      item.title = emoji;
      item.draggable = true;
      item.dataset.decorType = 'emoji';
      item.dataset.decorData = emoji;
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/decor-type', 'emoji');
        e.dataTransfer.setData('application/decor-data', emoji);
        e.dataTransfer.effectAllowed = 'copy';
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => item.classList.remove('dragging'));
      item.addEventListener('click', () => addDecorToPage('emoji', emoji));
      emojiPanel.appendChild(item);
    });
  }

  // SVG 面板
  const svgPanel = $('#decor-svg-panel');
  svgPanel.innerHTML = '';
  DECOR_SVG.forEach((decor, idx) => {
    const item = document.createElement('div');
    item.className = 'decor-item';
    item.title = decor.name;
    item.draggable = true;
    item.dataset.decorType = 'svg';
    item.dataset.decorData = String(idx);
    const thumb = document.createElement('div');
    thumb.className = 'decor-svg-thumb';
    thumb.innerHTML = decor.svg;
    item.appendChild(thumb);
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/decor-type', 'svg');
      e.dataTransfer.setData('application/decor-data', String(idx));
      e.dataTransfer.effectAllowed = 'copy';
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.addEventListener('click', () => addDecorToPage('svg', String(idx)));
    svgPanel.appendChild(item);
  });

  // 花边面板
  const borderPanel = $('#decor-border-panel');
  borderPanel.innerHTML = '';
  DECOR_BORDERS.forEach((border, idx) => {
    const item = document.createElement('div');
    item.className = 'decor-item';
    item.title = border.name;
    item.draggable = true;
    item.dataset.decorType = 'border';
    item.dataset.decorData = String(idx);
    const thumb = document.createElement('div');
    thumb.className = 'decor-svg-thumb';
    thumb.innerHTML = border.svg;
    item.appendChild(thumb);
    const label = document.createElement('div');
    label.style.cssText = 'position:absolute;bottom:2px;font-size:8px;color:#999;text-align:center;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    label.textContent = border.name;
    item.appendChild(label);
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/decor-type', 'border');
      e.dataTransfer.setData('application/decor-data', String(idx));
      e.dataTransfer.effectAllowed = 'copy';
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.addEventListener('click', () => addDecorToPage('border', String(idx)));
    borderPanel.appendChild(item);
  });
}

// 装饰素材标签页切换
function switchDecorTab(tabName) {
  $$('.decor-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.querySelector(`.decor-tab[data-decor-tab="${tabName}"]`);
  if (activeTab) activeTab.classList.add('active');
  $('#decor-emoji-panel').classList.toggle('hidden', tabName !== 'emoji');
  $('#decor-svg-panel').classList.toggle('hidden', tabName !== 'svg');
  $('#decor-border-panel').classList.toggle('hidden', tabName !== 'border');
}

// 将装饰元素添加到当前页面
function addDecorToPage(type, data) {
  if (state.albumPages.length === 0) {
    // 没有页面时，自动创建一个空白页
    if (state.selectedPhotos.size === 0) {
      showToast('请先在选片视图中精选照片，或点击"自动排版"');
      return;
    }
    // 创建空白自由排版页
    state.albumPages.push({
      type: 'free',
      elements: []
    });
    renderAlbumPages();
    showToast('已自动创建空白页面');
  }

  // 找到当前视口中最接近的页面
  let targetIndex = state.albumPages.length - 1;
  const mainArea = document.querySelector('.layout-main');
  if (mainArea) {
    let minDist = Infinity;
    const centerY = mainArea.scrollTop + mainArea.clientHeight / 2;
    $$('.album-page').forEach(pageEl => {
      const rect = pageEl.getBoundingClientRect();
      const mainRect = mainArea.getBoundingClientRect();
      const pageCenter = rect.top - mainRect.top + mainArea.scrollTop + rect.height / 2;
      const dist = Math.abs(pageCenter - centerY);
      if (dist < minDist) { minDist = dist; targetIndex = parseInt(pageEl.dataset.pageIndex); }
    });
  }

  const page = state.albumPages[targetIndex];
  if (!page.elements) page.elements = [];

  const elId = newElementId();
  let el;
  if (type === 'emoji') {
    el = {
      type: 'decor',
      subtype: 'emoji',
      id: elId,
      x: 60, y: 60, w: 60, h: 60,
      emoji: data,
      fontSize: 40
    };
  } else if (type === 'svg') {
    const svgDef = DECOR_SVG[parseInt(data)];
    el = {
      type: 'decor',
      subtype: 'svg',
      id: elId,
      x: 60, y: 60, w: 80, h: 80,
      svgContent: svgDef.svg,
      svgName: svgDef.name
    };
  } else if (type === 'border') {
    const borderDef = DECOR_BORDERS[parseInt(data)];
    const pageW = 620;
    const pageH = Math.round(620 / 0.705);
    el = {
      type: 'decor',
      subtype: 'border',
      id: elId,
      x: 10, y: 10, w: pageW - 20, h: pageH - 20,
      svgContent: borderDef.svg,
      svgName: borderDef.name
    };
  }
  if (el) {
    page.elements.push(el);
    editingPageIndex = targetIndex;
    renderAlbumPages();
    const name = type === 'emoji' ? data : (type === 'svg' ? DECOR_SVG[parseInt(data)].name : DECOR_BORDERS[parseInt(data)].name);
    showToast(`已添加「${name}」到第${targetIndex + 1}页`);
  }
}

// 页面 drop 事件需要支持装饰素材的拖入
const _origHandleDropOnPage = handleDropOnPage;
handleDropOnPage = function(e, page, pageIndex) {
  const decorType = e.dataTransfer.getData('application/decor-type');
  const decorData = e.dataTransfer.getData('application/decor-data');
  if (decorType) {
    // 装饰素材拖入
    if (!page.elements) page.elements = [];
    const elId = newElementId();
    const pageRect = e.target.closest('.album-page').getBoundingClientRect();
    let newX = Math.round(e.clientX - pageRect.left - 40);
    let newY = Math.round(e.clientY - pageRect.top - 40);
    newX = Math.max(0, Math.min(newX, 620 - 80));
    newY = Math.max(0, Math.min(newY, Math.round(620 / 0.705) - 80));
    let el;
    if (decorType === 'emoji') {
      el = { type: 'decor', subtype: 'emoji', id: elId, x: newX, y: newY, w: 60, h: 60, emoji: decorData, fontSize: 40 };
    } else if (decorType === 'svg') {
      const svgDef = DECOR_SVG[parseInt(decorData)];
      el = { type: 'decor', subtype: 'svg', id: elId, x: newX, y: newY, w: 80, h: 80, svgContent: svgDef.svg, svgName: svgDef.name };
    } else if (decorType === 'border') {
      const borderDef = DECOR_BORDERS[parseInt(decorData)];
      el = { type: 'decor', subtype: 'border', id: elId, x: 10, y: 10, w: 600, h: Math.round(620 / 0.705) - 20, svgContent: borderDef.svg, svgName: borderDef.name };
    }
    if (el) {
      page.elements.push(el);
      renderAlbumPages();
      const name = decorType === 'emoji' ? decorData : (decorType === 'svg' ? DECOR_SVG[parseInt(decorData)].name : DECOR_BORDERS[parseInt(decorData)].name);
      showToast(`已拖入「${name}」`);
    }
    return;
  }
  return _origHandleDropOnPage(e, page, pageIndex);
};

// ==================== 更新 renderElement 支持装饰元素 ====================
const _origRenderElement = renderElement;
renderElement = function(pageEl, page, el, pageIndex) {
  if (el.type === 'decor') {
    renderDecorElement(pageEl, page, el, pageIndex);
    return;
  }
  return _origRenderElement(pageEl, page, el, pageIndex);
};

// 渲染装饰元素
function renderDecorElement(pageEl, page, el, pageIndex) {
  const elDiv = document.createElement('div');
  elDiv.className = 'free-element free-decor';
  elDiv.dataset.elementId = el.id;
  elDiv.style.left = el.x + 'px';
  elDiv.style.top = el.y + 'px';
  elDiv.style.width = el.w + 'px';
  elDiv.style.height = el.h + 'px';
  if (el.rotation) {
    elDiv.style.transform = `rotate(${el.rotation}deg)`;
  }

  if (el.subtype === 'emoji') {
    const span = document.createElement('span');
    span.textContent = el.emoji;
    span.style.cssText = `font-size:${el.fontSize || 40}px;line-height:1;display:flex;align-items:center;justify-content:center;width:100%;height:100%;pointer-events:none;`;
    elDiv.appendChild(span);
  } else if (el.subtype === 'svg' || el.subtype === 'border') {
    const svgWrap = document.createElement('div');
    svgWrap.style.cssText = 'width:100%;height:100%;pointer-events:none;display:flex;align-items:center;justify-content:center;';
    svgWrap.innerHTML = el.svgContent;
    elDiv.appendChild(svgWrap);
  }

  // 装饰元素不使用 HTML5 原生拖拽，改为自定义鼠标拖拽（在页面内自由移动）
  // 选中边框
  const selectBorder = document.createElement('div');
  selectBorder.className = 'element-select-border';
  elDiv.appendChild(selectBorder);

  // 调整大小手柄
  const handles = ['nw', 'ne', 'sw', 'se'];
  handles.forEach(h => {
    const handle = document.createElement('div');
    handle.className = `resize-handle resize-${h}`;
    handle.dataset.handle = h;
    elDiv.appendChild(handle);
  });

  // 旋转手柄
  const rotateHandle = document.createElement('div');
  rotateHandle.className = 'rotate-handle';
  rotateHandle.title = '旋转';
  rotateHandle.innerHTML = '↻';
  rotateHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startRotate(el, elDiv, pageEl, e);
  });
  elDiv.appendChild(rotateHandle);

  // 删除按钮
  const delBtn = document.createElement('button');
  delBtn.className = 'element-delete-btn';
  delBtn.textContent = '×';
  delBtn.title = '删除装饰';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    page.elements = page.elements.filter(e => e.id !== el.id);
    if (state.selectedElement && state.selectedElement.el.id === el.id) {
      state.selectedElement = null;
      hideTextPropsBar();
    }
    renderAlbumPages();
  });
  elDiv.appendChild(delBtn);

  // 点击选中 + 开始拖拽（支持在页面内自由移动位置）
  elDiv.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('resize-handle')) return;
    if (e.target.classList.contains('rotate-handle')) return;
    if (e.target.classList.contains('element-delete-btn')) return;
    e.preventDefault();
    e.stopPropagation();
    selectElement(el, elDiv, pageEl, e);
    hideTextPropsBar();
  });

  pageEl.appendChild(elDiv);
}

// 初始化装饰面板
renderDecorPanels();

// 装饰标签页切换事件
$$('.decor-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    switchDecorTab(tab.dataset.decorTab);
  });
});

// ==================== 全局 drop zone（无页面时也能接收装饰素材） ====================
const albumPagesContainer = $('#album-pages');
albumPagesContainer.addEventListener('dragover', (e) => {
  // Chrome 在 dragover 中无法读取自定义 data，用 types 判断
  if (e.dataTransfer.types.includes('application/decor-type')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    albumPagesContainer.classList.add('drag-over');
  }
});
albumPagesContainer.addEventListener('dragleave', (e) => {
  albumPagesContainer.classList.remove('drag-over');
});
albumPagesContainer.addEventListener('drop', (e) => {
  e.preventDefault();
  albumPagesContainer.classList.remove('drag-over');
  const decorType = e.dataTransfer.getData('application/decor-type');
  if (!decorType) return;
  const decorData = e.dataTransfer.getData('application/decor-data');
  // 没有页面时自动创建空白页
  if (state.albumPages.length === 0) {
    if (state.selectedPhotos.size === 0) {
      showToast('请先在选片视图中精选照片，或点击"自动排版"');
      return;
    }
    state.albumPages.push({ type: 'free', elements: [] });
    renderAlbumPages();
    showToast('已自动创建空白页面');
  }
  // 延迟一下等 DOM 更新后，将装饰添加到最后一页
  setTimeout(() => {
    const page = state.albumPages[state.albumPages.length - 1];
    if (!page) return;
    if (!page.elements) page.elements = [];
    const elId = newElementId();
    let el;
    if (decorType === 'emoji') {
      el = { type: 'decor', subtype: 'emoji', id: elId, x: 60, y: 60, w: 60, h: 60, emoji: decorData, fontSize: 40 };
    } else if (decorType === 'svg') {
      const svgDef = DECOR_SVG[parseInt(decorData)];
      el = { type: 'decor', subtype: 'svg', id: elId, x: 60, y: 60, w: 80, h: 80, svgContent: svgDef.svg, svgName: svgDef.name };
    } else if (decorType === 'border') {
      const borderDef = DECOR_BORDERS[parseInt(decorData)];
      el = { type: 'decor', subtype: 'border', id: elId, x: 10, y: 10, w: 600, h: Math.round(620 / 0.705) - 20, svgContent: borderDef.svg, svgName: borderDef.name };
    }
    if (el) {
      page.elements.push(el);
      renderAlbumPages();
      const name = decorType === 'emoji' ? decorData : (decorType === 'svg' ? DECOR_SVG[parseInt(decorData)].name : DECOR_BORDERS[parseInt(decorData)].name);
      showToast(`已拖入「${name}」`);
    }
  }, 100);
});

// ==================== 自动保存系统 ====================
const AUTO_SAVE_KEY = 'photo-album-autosave';
let _autoSaveTimer = null;
let _lastManualSaveTime = 0;
let _hasUnsavedChanges = false;

function autoSave() {
  if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => {
    if (!state.rootDir && state.selectedPhotos.size === 0 && state.albumPages.length === 0) return;
    try {
      const data = {
        rootDir: state.rootDir,
        selectedPhotos: [...state.selectedPhotos.values()],
        albumPages: state.albumPages,
        theme: state.theme,
        albumTitle: state.albumTitle,
        albumSubtitle: state.albumSubtitle,
        coverPhoto: state.coverPhoto,
        frameStyle: state.frameStyle,
        showDecorations: state.showDecorations,
        savedAt: Date.now(),
        version: '3.5'
      };
      localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(data));
      _hasUnsavedChanges = true;
    } catch (e) {
      // localStorage 可能满，忽略错误
      console.warn('自动保存失败:', e.message);
    }
  }, 300);
}

function checkAutoSave() {
  try {
    const raw = localStorage.getItem(AUTO_SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data.rootDir && data.selectedPhotos.length === 0 && data.albumPages.length === 0) return false;
    return data;
  } catch (e) {
    return false;
  }
}

function restoreAutoSave(data) {
  state.rootDir = data.rootDir;
  state.selectedPhotos = new Map();
  if (data.selectedPhotos) {
    for (const p of data.selectedPhotos) state.selectedPhotos.set(p.path, p);
  }
  state.albumPages = data.albumPages || [];
  state.theme = data.theme || 'warm';
  state.albumTitle = data.albumTitle || '成长纪念册';
  state.albumSubtitle = data.albumSubtitle || '记录每一个美好瞬间';
  state.coverPhoto = data.coverPhoto || null;
  state.frameStyle = data.frameStyle || 'clean';
  state.showDecorations = data.showDecorations !== false;
  setTheme(state.theme);
  if (state.rootDir) {
    $('#dir-path').textContent = state.rootDir;
  }
  updateSelectedCount();
  renderSelectedPanel();
  renderYearNav();
  switchView('layout');
  _hasUnsavedChanges = false;
  showToast('✅ 已恢复上次的编辑内容');
}

// 页面关闭前提醒
window.addEventListener('beforeunload', (e) => {
  if (_hasUnsavedChanges && (state.selectedPhotos.size > 0 || state.albumPages.length > 0)) {
    e.preventDefault();
    e.returnValue = '您有未保存的排版内容，确定要离开吗？建议先点击"保存"按钮。';
    return e.returnValue;
  }
});

// ==================== 初始化 ====================
console.log('📸 自由相册排版软件 v3.5 已就绪');
console.log('自由排版功能：');
console.log('  ✨ 照片和文字可自由拖拽位置');
console.log('  ✨ 可自由调整元素大小');
console.log('  ✨ 可自由旋转元素（选中后拖顶部↻手柄）');
console.log('  ✨ 文字完整编辑：字体/字号/颜色/加粗/斜体/对齐/间距/透明度');
console.log('  ✨ 可自由添加/删除照片和文字');
console.log('  ✨ 所有自动生成内容可编辑可删除');
console.log('  ✨ 支持任意题材，不限于儿童照片');
console.log('  🎨 内置装饰素材库：Emoji / SVG / 花边边框');
console.log('  🎨 支持拖拽或点击添加装饰到页面');
console.log('  💾 自动保存到浏览器 — 刷新页面不会丢失数据');

// 启动时检测自动保存
const autoSaveData = checkAutoSave();
if (autoSaveData) {
  const age = Date.now() - (autoSaveData.savedAt || 0);
  const ageStr = age < 60000 ? '刚刚' : age < 3600000 ? `${Math.round(age / 60000)}分钟前` : `${Math.round(age / 3600000)}小时前`;
  const pageCount = autoSaveData.albumPages ? autoSaveData.albumPages.length : 0;
  const photoCount = autoSaveData.selectedPhotos ? autoSaveData.selectedPhotos.length : 0;
  
  // 延迟弹出恢复提示，等 DOM 就绪
  setTimeout(() => {
    const shouldRestore = confirm(
      `🔔 检测到自动保存的排版内容：\n\n` +
      `📷 精选照片：${photoCount} 张\n` +
      `📄 排版页面：${pageCount} 页\n` +
      `🕐 保存时间：${ageStr}\n\n` +
      `是否恢复？\n（点击"取消"将清除自动保存）`
    );
    if (shouldRestore) {
      restoreAutoSave(autoSaveData);
    } else {
      localStorage.removeItem(AUTO_SAVE_KEY);
    }
  }, 500);
}
