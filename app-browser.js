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
  const dir = await API.selectDirectory();
  hideLoading();
  if (!dir) return;
  await loadDirectory(dir);
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
  const fragment = document.createDocumentFragment();
  for (let idx = 0; idx < filtered.length; idx++) {
    const photo = filtered[idx];
    const card = document.createElement('div');
    card.className = 'photo-card';
    if (state.selectedPhotos.has(photo.path)) card.classList.add('selected');
    card.dataset.path = photo.path;
    card.dataset.idx = idx;
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = API.thumbnailUrl(photo.path);
    img.alt = photo.name;
    card.appendChild(img);
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
      toggleSelectPhoto(photo, card);
    });
    card.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const realIdx = photos.indexOf(photo);
      openLightbox(realIdx);
    });
    fragment.appendChild(card);
  }
  grid.appendChild(fragment);
  updateSelectedCount();
}
$('#search-input').addEventListener('input', () => {
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
});
$('#btn-deselect-all').addEventListener('click', () => {
  $$('.photo-card').forEach(card => {
    card.classList.remove('selected');
    card.querySelector('.check-overlay').textContent = '';
  });
  state.selectedPhotos.clear();
  updateSelectedCount();
  renderSelectedPanel();
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
  $$('.photo-card').forEach(c => {
    c.classList.remove('selected');
    c.querySelector('.check-overlay').textContent = '';
  });
});

// ==================== 大图预览 ====================
function openLightbox(index) {
  state.lightboxIndex = index;
  const photo = state.currentPhotos[index];
  if (!photo) return;
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
  $('#lightbox-next').style.display = index < state.currentPhotos.length - 1 ? 'flex' : 'none';
}
function closeLightbox() {
  $('#lightbox').classList.add('hidden');
  state.lightboxIndex = -1;
}
$('#lightbox .lightbox-overlay').addEventListener('click', closeLightbox);
$('#lightbox .lightbox-close').addEventListener('click', closeLightbox);
$('#lightbox-prev').addEventListener('click', (e) => {
  e.stopPropagation();
  if (state.lightboxIndex > 0) openLightbox(state.lightboxIndex - 1);
});
$('#lightbox-next').addEventListener('click', (e) => {
  e.stopPropagation();
  if (state.lightboxIndex < state.currentPhotos.length - 1) openLightbox(state.lightboxIndex + 1);
});
$('#btn-lightbox-select').addEventListener('click', () => {
  const photo = state.currentPhotos[state.lightboxIndex];
  if (!photo) return;
  const card = document.querySelector(`.photo-card[data-path="${CSS.escape(photo.path)}"]`);
  toggleSelectPhoto(photo, card);
  if (state.selectedPhotos.has(photo.path)) {
    $('#btn-lightbox-select').textContent = '⭐ 取消精选';
  } else {
    $('#btn-lightbox-select').textContent = '⭐ 选入精选';
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
  if (!$('#lightbox').classList.contains('hidden')) {
    if (e.key === 'ArrowLeft' && state.lightboxIndex > 0) openLightbox(state.lightboxIndex - 1);
    if (e.key === 'ArrowRight' && state.lightboxIndex < state.currentPhotos.length - 1) openLightbox(state.lightboxIndex + 1);
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
      x: 160, y: 80, w: 200, h: 70,
      text: yearNum ? String(yearNum) : yf,
      fontSize: 64, color: 'var(--theme-primary)', align: 'center',
      fontWeight: '700', opacity: 0.7
    });
    // 副标题
    coverElements.push({
      type: 'text', id: newElementId(),
      x: 110, y: 170, w: 300, h: 40,
      text: '美好的时光',
      fontSize: 20, color: 'var(--theme-text-secondary)', align: 'center',
      letterSpacing: '6px'
    });
    // 照片区域（如果有照片）
    if (yearPhotos.length > 0) {
      coverElements.push({
        type: 'photo', id: newElementId(),
        x: 60, y: 240, w: 400, h: 280,
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
    while (i < yearPhotos.length) {
      const left = yearPhotos.length - i;
      const count = left >= 4 ? 4 : left >= 3 ? 3 : left >= 2 ? 2 : 1;
      const pagePhotos = yearPhotos.slice(i, i + count);
      const elements = [];
      if (count === 1) {
        elements.push({ type: 'photo', id: newElementId(), x: 60, y: 60, w: 400, h: 520, photo: pagePhotos[0], caption: '', frame: 'clean' });
      } else if (count === 2) {
        elements.push({ type: 'photo', id: newElementId(), x: 30, y: 60, w: 230, h: 520, photo: pagePhotos[0], caption: '', frame: 'clean' });
        elements.push({ type: 'photo', id: newElementId(), x: 270, y: 60, w: 230, h: 520, photo: pagePhotos[1], caption: '', frame: 'clean' });
      } else if (count === 3) {
        elements.push({ type: 'photo', id: newElementId(), x: 30, y: 60, w: 460, h: 300, photo: pagePhotos[0], caption: '', frame: 'clean' });
        elements.push({ type: 'photo', id: newElementId(), x: 30, y: 380, w: 220, h: 200, photo: pagePhotos[1], caption: '', frame: 'clean' });
        elements.push({ type: 'photo', id: newElementId(), x: 270, y: 380, w: 220, h: 200, photo: pagePhotos[2], caption: '', frame: 'clean' });
      } else {
        elements.push({ type: 'photo', id: newElementId(), x: 30, y: 60, w: 220, h: 260, photo: pagePhotos[0], caption: '', frame: 'clean' });
        elements.push({ type: 'photo', id: newElementId(), x: 270, y: 60, w: 220, h: 260, photo: pagePhotos[1], caption: '', frame: 'clean' });
        elements.push({ type: 'photo', id: newElementId(), x: 30, y: 340, w: 220, h: 260, photo: pagePhotos[2], caption: '', frame: 'clean' });
        elements.push({ type: 'photo', id: newElementId(), x: 270, y: 340, w: 220, h: 260, photo: pagePhotos[3], caption: '', frame: 'clean' });
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
    container.innerHTML = `
      <div style="text-align:center;padding:60px;color:#999;">
        <div style="font-size:48px;margin-bottom:16px;">📐</div>
        <div style="font-size:16px;margin-bottom:8px;">还没有排版</div>
        <div style="font-size:13px;">请先在选片视图中精选照片，然后点击 ✨"自动排版"</div>
      </div>
    `;
    return;
  }
  const pageWidth = 520;
  const pageHeight = Math.round(pageWidth / 0.705);
  state.albumPages.forEach((page, pageIndex) => {
    const pageEl = document.createElement('div');
    pageEl.className = 'album-page free-layout-page';
    pageEl.style.width = pageWidth + 'px';
    pageEl.style.height = pageHeight + 'px';
    pageEl.dataset.pageIndex = pageIndex;

    // 工具栏
    addFreePageToolbar(pageEl, page, pageIndex);

    // 渲染所有元素
    if (page.elements) {
      page.elements.forEach(el => {
        renderElement(pageEl, page, el, pageIndex);
      });
    }

    // 页码
    const pageNum = document.createElement('div');
    pageNum.className = 'page-number';
    pageNum.textContent = `${pageIndex + 1}`;
    pageEl.appendChild(pageNum);

    container.appendChild(pageEl);
  });
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
    if (el.photo) {
      const img = document.createElement('img');
      img.src = API.thumbnailUrl(el.photo.path);
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

  // 删除按钮
  const delBtn = document.createElement('button');
  delBtn.className = 'element-delete-btn';
  delBtn.textContent = '×';
  delBtn.title = '删除元素';
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
document.addEventListener('mousemove', (e) => {
  if (state.isDragging && state.selectedElement) {
    e.preventDefault();
    const { el, elDiv, pageEl } = state.selectedElement;
    const pageRect = pageEl.getBoundingClientRect();
    let newX = e.clientX - pageRect.left - state.dragOffset.x;
    let newY = e.clientY - pageRect.top - state.dragOffset.y;
    // 限制在页面内
    newX = Math.max(0, Math.min(newX, 520 - el.w));
    newY = Math.max(0, Math.min(newY, pageEl.offsetHeight - el.h));
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

document.addEventListener('mouseup', () => {
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
  const baseW = 520;
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
  showToast('项目已保存');
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
          renderExportElement(pageEl, el, renderW / 520, renderH / Math.round(520 / 0.705));
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
          renderExportElement(pageEl, el, renderW / 520, renderH / Math.round(520 / 0.705));
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

// ==================== 初始化 ====================
console.log('📸 自由相册排版软件 v3.2 已就绪');
console.log('自由排版功能：');
console.log('  ✨ 照片和文字可自由拖拽位置');
console.log('  ✨ 可自由调整元素大小');
console.log('  ✨ 可自由旋转元素（选中后拖顶部↻手柄）');
console.log('  ✨ 文字完整编辑：字体/字号/颜色/加粗/斜体/对齐/间距/透明度');
console.log('  ✨ 可自由添加/删除照片和文字');
console.log('  ✨ 所有自动生成内容可编辑可删除');
console.log('  ✨ 支持任意题材，不限于儿童照片');
