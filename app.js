// ==================== 全局状态 ====================
const state = {
  rootDir: null,
  photoData: {},        // { yearFolder: [{ monthFolder, photos }] }
  selectedPhotos: new Map(),  // path -> photoObj
  thumbnailCache: new Map(),  // path -> base64
  albumPages: [],       // [{ layout, slots: [{photo, caption}] }]
  currentView: 'select',
  currentYear: null,
  currentMonth: null,
  previewPage: 0,
  previewZoom: 70
};

// ==================== DOM 引用 ====================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

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

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// 将 yearFolder 转为可读标签
function yearFolderLabel(yf) {
  // "2008年出生" -> "2008年 (出生)"
  const m = yf.match(/^(\d{4})/);
  if (m) {
    const rest = yf.replace(m[1], '').replace(/[年_\-]/g, ' ').trim();
    return rest ? `${m[1]}年 ${rest}` : `${m[1]}年`;
  }
  return yf;
}

// 将 monthFolder 转为可读标签
function monthFolderLabel(mf) {
  // "200804" -> "4月"
  const m = mf.match(/^(\d{4})(\d{2})/);
  if (m) return `${parseInt(m[2])}月`;
  return mf;
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
$('#btn-select-dir').addEventListener('click', async () => {
  const dir = await window.electronAPI.selectDirectory();
  if (!dir) return;
  
  state.rootDir = dir;
  $('#dir-path').textContent = dir;
  
  showLoading('正在扫描照片目录...');
  try {
    state.photoData = await window.electronAPI.scanPhotos(dir);
    renderYearNav();
    showToast(`扫描完成！共发现 ${countAllPhotos()} 张照片`);
  } catch (e) {
    showToast('扫描失败：' + e.message);
  }
  hideLoading();
});

function countAllPhotos() {
  let count = 0;
  for (const months of Object.values(state.photoData)) {
    for (const m of months) {
      count += m.photos.length;
    }
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
      // 展开/收起月份
      const wasActive = yearDiv.classList.contains('active');
      // 收起所有
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
  
  // "全部" 选项
  const allItem = document.createElement('div');
  allItem.className = 'month-item active';
  allItem.innerHTML = `📂 全部 <span class="count">${months.reduce((s,m)=>s+m.photos.length,0)}张</span>`;
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
async function renderPhotoGrid(yearFolder, monthFolder) {
  const grid = $('#photo-grid');
  grid.innerHTML = '';
  
  if (!yearFolder) {
    $('#current-section-title').textContent = '请选择年份查看照片';
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
  
  const title = monthFolder 
    ? `${yearFolderLabel(yearFolder)} · ${monthFolderLabel(monthFolder)}`
    : yearFolderLabel(yearFolder);
  $('#current-section-title').textContent = `${title} (${photos.length}张)`;
  
  // 渲染照片卡片
  for (const photo of photos) {
    const card = document.createElement('div');
    card.className = 'photo-card';
    if (state.selectedPhotos.has(photo.path)) {
      card.classList.add('selected');
    }
    card.dataset.path = photo.path;
    
    // 缩略图
    const img = document.createElement('img');
    img.src = 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" fill="%23e0e0e0"><rect width="150" height="150"/><text x="50%" y="50%" text-anchor="middle" dy=".3em" font-size="14" fill="%23999">加载中</text></svg>'
    );
    img.dataset.path = photo.path;
    card.appendChild(img);
    
    // 选中标记
    const check = document.createElement('div');
    check.className = 'check-overlay';
    check.textContent = state.selectedPhotos.has(photo.path) ? '✓' : '';
    card.appendChild(check);
    
    // 文件名
    const name = document.createElement('div');
    name.className = 'photo-name';
    name.textContent = photo.name;
    card.appendChild(name);
    
    // 点击切换选中
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSelectPhoto(photo, card);
    });
    
    // 双击大图预览
    card.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      openLightbox(photo);
    });
    
    grid.appendChild(card);
  }
  
  // 延迟加载缩略图（可视区域优先）
  loadVisibleThumbnails();
  
  updateSelectedCount();
}

// 懒加载缩略图
function loadVisibleThumbnails() {
  const grid = $('#photo-grid');
  const imgs = grid.querySelectorAll('img[data-path]:not([data-loaded])');
  const gridRect = grid.getBoundingClientRect();
  
  let loaded = 0;
  for (const img of imgs) {
    if (loaded >= 30) break; // 每次最多加载30张
    
    const rect = img.getBoundingClientRect();
    // 在可视区域或附近
    if (rect.top < gridRect.bottom + 600 && rect.bottom > gridRect.top - 600) {
      const path = img.dataset.path;
      img.dataset.loaded = '1';
      loadThumbnail(path, img);
      loaded++;
    }
  }
}

async function loadThumbnail(path, imgElement) {
  // 检查缓存
  if (state.thumbnailCache.has(path)) {
    imgElement.src = 'data:image/jpeg;base64,' + state.thumbnailCache.get(path);
    return;
  }
  
  try {
    const base64 = await window.electronAPI.getThumbnail(path, 300);
    if (base64) {
      state.thumbnailCache.set(path, base64);
      imgElement.src = 'data:image/jpeg;base64,' + base64;
    }
  } catch (e) {
    // 忽略
  }
}

// 滚动加载更多
$('#photo-grid').addEventListener('scroll', () => {
  loadVisibleThumbnails();
});

// ==================== 照片选择 ====================
function toggleSelectPhoto(photo, card) {
  if (state.selectedPhotos.has(photo.path)) {
    state.selectedPhotos.delete(photo.path);
    if (card) card.classList.remove('selected');
    if (card) card.querySelector('.check-overlay').textContent = '';
  } else {
    state.selectedPhotos.set(photo.path, photo);
    if (card) card.classList.add('selected');
    if (card) card.querySelector('.check-overlay').textContent = '✓';
  }
  updateSelectedCount();
  renderSelectedPanel();
}

function updateSelectedCount() {
  $('#selected-count').textContent = `已选 ${state.selectedPhotos.size} 张`;
  $('#panel-count').textContent = state.selectedPhotos.size;
}

// 全选/取消全选
$('#btn-select-all').addEventListener('click', () => {
  const cards = $$('.photo-card');
  cards.forEach(card => {
    const path = card.dataset.path;
    if (!state.selectedPhotos.has(path)) {
      // 找到对应的 photo 对象
      const photo = findPhotoByPath(path);
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
  const cards = $$('.photo-card');
  cards.forEach(card => {
    card.classList.remove('selected');
    card.querySelector('.check-overlay').textContent = '';
  });
  state.selectedPhotos.clear();
  updateSelectedCount();
  renderSelectedPanel();
});

function findPhotoByPath(path) {
  for (const months of Object.values(state.photoData)) {
    for (const m of months) {
      for (const p of m.photos) {
        if (p.path === path) return p;
      }
    }
  }
  return null;
}

// ==================== 已选面板 ====================
function renderSelectedPanel() {
  const container = $('#selected-list');
  container.innerHTML = '';
  
  // 按年份分组
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
      if (state.thumbnailCache.has(photo.path)) {
        thumb.src = 'data:image/jpeg;base64,' + state.thumbnailCache.get(photo.path);
      }
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
        // 同步更新网格
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
    container.innerHTML = '<div style="text-align:center;color:#ccc;padding:20px;font-size:13px;">点击照片进行精选</div>';
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
let lightboxPhoto = null;

function openLightbox(photo) {
  lightboxPhoto = photo;
  $('#lightbox-img').src = '';
  $('#lightbox-filename').textContent = photo.name;
  $('#lightbox').classList.remove('hidden');
  
  // 是否已选
  const selectBtn = $('#btn-lightbox-select');
  if (state.selectedPhotos.has(photo.path)) {
    selectBtn.textContent = '⭐ 取消精选';
    selectBtn.classList.add('selected-in-lightbox');
  } else {
    selectBtn.textContent = '⭐ 选入精选';
    selectBtn.classList.remove('selected-in-lightbox');
  }
  
  // 加载原图
  window.electronAPI.getFullImage(photo.path).then(base64 => {
    if (base64) {
      $('#lightbox-img').src = 'data:image/jpeg;base64,' + base64;
    }
  });
}

$('#lightbox .lightbox-overlay').addEventListener('click', closeLightbox);
$('#lightbox .lightbox-close').addEventListener('click', closeLightbox);

function closeLightbox() {
  $('#lightbox').classList.add('hidden');
  lightboxPhoto = null;
}

$('#btn-lightbox-select').addEventListener('click', () => {
  if (!lightboxPhoto) return;
  const card = document.querySelector(`.photo-card[data-path="${CSS.escape(lightboxPhoto.path)}"]`);
  toggleSelectPhoto(lightboxPhoto, card);
  
  const selectBtn = $('#btn-lightbox-select');
  if (state.selectedPhotos.has(lightboxPhoto.path)) {
    selectBtn.textContent = '⭐ 取消精选';
  } else {
    selectBtn.textContent = '⭐ 选入精选';
  }
});

// 键盘导航
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
});

// ==================== 去排版按钮 ====================
$('#btn-go-layout').addEventListener('click', () => {
  if (state.selectedPhotos.size === 0) {
    showToast('请先精选一些照片');
    return;
  }
  switchView('layout');
});

// ==================== 自动排版引擎 ====================
const LAYOUTS = {
  // 布局名称: [列配置, 适合照片数]
  'full':       { cols: '1fr', rows: '1fr', name: '整页单张', count: 1, cls: 'layout-1' },
  'side-by-side': { cols: '1fr 1fr', rows: '1fr', name: '左右并排', count: 2, cls: 'layout-2' },
  'stack':      { cols: '1fr', rows: '1fr 1fr', name: '上下叠放', count: 2, cls: 'layout-2v' },
  'big-small':  { cols: '2fr 1fr', rows: '1fr', name: '一大一小', count: 2, cls: 'layout-2-1' },
  'grid2x2':    { cols: '1fr 1fr', rows: '1fr 1fr', name: '四格', count: 4, cls: 'layout-4' },
  'triple-top': { cols: '1fr 1fr', rows: '2fr 1fr', name: '上大下两小', count: 3, cls: 'layout-3-1' },
  'triple-left':{ cols: '2fr 1fr', rows: '1fr 1fr', name: '左大右两小', count: 3, cls: 'layout-3-2' },
  'triple-stack':{ cols: '1fr', rows: '1fr 1fr 1fr', name: '三张竖排', count: 3, cls: 'layout-1-1-2' },
};

// 自动排版算法：按年份分组，每页智能分配布局
function autoLayout(photos) {
  const pages = [];
  
  // 按年份分组排序
  const byYear = new Map();
  for (const photo of photos) {
    const yf = photo.yearFolder || '未知';
    if (!byYear.has(yf)) byYear.set(yf, []);
    byYear.get(yf).push(photo);
  }
  
  const sortedYears = [...byYear.keys()].sort();
  
  for (const yf of sortedYears) {
    const yearPhotos = byYear.get(yf);
    
    // 年份封面页
    if (yearPhotos.length > 0) {
      // 挑一张做封面
      pages.push({
        type: 'cover',
        yearLabel: yearFolderLabel(yf),
        layout: 'full',
        slots: [{ photo: yearPhotos[0], caption: yearFolderLabel(yf) }]
      });
      
      // 剩余照片排版
      const remaining = yearPhotos.slice(1);
      let i = 0;
      
      while (i < remaining.length) {
        const left = remaining.length - i;
        let layoutKey, slotCount;
        
        if (left >= 4 && Math.random() > 0.3) {
          layoutKey = 'grid2x2'; slotCount = 4;
        } else if (left >= 3 && Math.random() > 0.3) {
          const opts = ['triple-top', 'triple-left', 'triple-stack'];
          layoutKey = opts[Math.floor(Math.random() * opts.length)];
          slotCount = 3;
        } else if (left >= 2 && Math.random() > 0.3) {
          const opts = ['side-by-side', 'big-small', 'stack'];
          layoutKey = opts[Math.floor(Math.random() * opts.length)];
          slotCount = 2;
        } else {
          layoutKey = 'full';
          slotCount = 1;
        }
        
        const layout = LAYOUTS[layoutKey];
        const slots = [];
        for (let j = 0; j < slotCount && i < remaining.length; j++, i++) {
          slots.push({ photo: remaining[i], caption: '' });
        }
        
        pages.push({
          type: 'page',
          yearLabel: yearFolderLabel(yf),
          layout: layoutKey,
          slots: slots
        });
      }
    }
  }
  
  return pages;
}

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

// ==================== 排版视图渲染 ====================
function renderAlbumPages() {
  const container = $('#album-pages');
  container.innerHTML = '';
  
  if (state.albumPages.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:60px;color:#999;">
        <div style="font-size:48px;margin-bottom:16px;">📐</div>
        <div style="font-size:16px;margin-bottom:8px;">还没有排版</div>
        <div style="font-size:13px;">请先在选片视图中精选照片，然后点击"自动排版"</div>
      </div>
    `;
    return;
  }
  
  state.albumPages.forEach((page, pageIndex) => {
    const pageEl = document.createElement('div');
    pageEl.className = 'album-page';
    // A4 横版比例: 297/210 ≈ 1.414
    const pageWidth = 800;
    const pageHeight = Math.round(pageWidth / 1.414);
    pageEl.style.width = pageWidth + 'px';
    pageEl.style.height = pageHeight + 'px';
    
    // 页面工具栏
    const toolbar = document.createElement('div');
    toolbar.className = 'page-toolbar';
    
    const layoutSelect = document.createElement('select');
    Object.entries(LAYOUTS).forEach(([key, l]) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = l.name;
      if (key === page.layout) opt.selected = true;
      layoutSelect.appendChild(opt);
    });
    layoutSelect.addEventListener('change', (e) => {
      changePageLayout(pageIndex, e.target.value);
    });
    toolbar.appendChild(layoutSelect);
    
    const delBtn = document.createElement('button');
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', () => {
      state.albumPages.splice(pageIndex, 1);
      renderAlbumPages();
    });
    toolbar.appendChild(delBtn);
    
    pageEl.appendChild(toolbar);
    
    // 年份标签
    if (page.type === 'cover' || pageIndex === 0 || state.albumPages[pageIndex-1].yearLabel !== page.yearLabel) {
      const header = document.createElement('div');
      header.className = 'page-header';
      header.textContent = page.yearLabel;
      pageEl.appendChild(header);
    }
    
    // 照片网格
    const grid = document.createElement('div');
    const layoutCfg = LAYOUTS[page.layout] || LAYOUTS['full'];
    grid.className = 'page-grid ' + layoutCfg.cls;
    
    const slotCount = layoutCfg.count;
    for (let i = 0; i < slotCount; i++) {
      const slot = document.createElement('div');
      slot.className = 'page-slot';
      slot.dataset.pageIndex = pageIndex;
      slot.dataset.slotIndex = i;
      
      if (page.slots[i] && page.slots[i].photo) {
        slot.classList.add('filled');
        const img = document.createElement('img');
        const photoPath = page.slots[i].photo.path;
        if (state.thumbnailCache.has(photoPath)) {
          img.src = 'data:image/jpeg;base64,' + state.thumbnailCache.get(photoPath);
        } else {
          // 异步加载
          window.electronAPI.getThumbnail(photoPath, 400).then(b64 => {
            if (b64) {
              state.thumbnailCache.set(photoPath, b64);
              img.src = 'data:image/jpeg;base64,' + b64;
            }
          });
        }
        slot.appendChild(img);
        
        // 操作按钮
        const actions = document.createElement('div');
        actions.className = 'slot-actions';
        
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '×';
        removeBtn.title = '移除照片';
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          page.slots[i] = null;
          renderAlbumPages();
        });
        actions.appendChild(removeBtn);
        
        slot.appendChild(actions);
      } else {
        const hint = document.createElement('span');
        hint.className = 'empty-hint';
        hint.textContent = '+ 拖放照片';
        slot.appendChild(hint);
      }
      
      // 点击空位选择照片
      slot.addEventListener('click', () => {
        if (!page.slots[i] || !page.slots[i].photo) {
          pickPhotoForSlot(pageIndex, i);
        }
      });
      
      // 支持拖放
      slot.addEventListener('dragover', (e) => {
        e.preventDefault();
        slot.style.borderColor = 'var(--accent)';
      });
      slot.addEventListener('dragleave', () => {
        slot.style.borderColor = '';
      });
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.style.borderColor = '';
        const data = e.dataTransfer.getData('text/plain');
        if (data) {
          try {
            const { pageIndex: srcPage, slotIndex: srcSlot } = JSON.parse(data);
            movePhotoSlot(srcPage, srcSlot, pageIndex, i);
          } catch {}
        }
      });
      
      grid.appendChild(slot);
    }
    
    // 使已有照片可拖拽
    for (let i = 0; i < slotCount; i++) {
      const slot = grid.children[i];
      if (page.slots[i] && page.slots[i].photo) {
        slot.draggable = true;
        slot.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', JSON.stringify({ pageIndex, slotIndex: i }));
          e.dataTransfer.effectAllowed = 'move';
        });
      }
    }
    
    pageEl.appendChild(grid);
    
    // 页码
    const pageNum = document.createElement('div');
    pageNum.className = 'page-number';
    pageNum.textContent = `第 ${pageIndex + 1} 页`;
    pageEl.appendChild(pageNum);
    
    container.appendChild(pageEl);
  });
}

function changePageLayout(pageIndex, newLayout) {
  const page = state.albumPages[pageIndex];
  const oldLayout = LAYOUTS[page.layout];
  const newLayoutCfg = LAYOUTS[newLayout];
  
  // 保留现有照片
  const oldSlots = [...page.slots];
  const newSlots = [];
  for (let i = 0; i < newLayoutCfg.count; i++) {
    newSlots.push(oldSlots[i] || null);
  }
  
  page.layout = newLayout;
  page.slots = newSlots;
  renderAlbumPages();
}

function movePhotoSlot(srcPage, srcSlot, dstPage, dstSlot) {
  const srcPhoto = state.albumPages[srcPage].slots[srcSlot];
  const dstPhoto = state.albumPages[dstPage].slots[dstSlot];
  
  state.albumPages[srcPage].slots[srcSlot] = dstPhoto;
  state.albumPages[dstPage].slots[dstSlot] = srcPhoto;
  
  renderAlbumPages();
}

// 为指定位置选择照片
function pickPhotoForSlot(pageIndex, slotIndex) {
  // 从已选照片中弹出选择
  const photos = [...state.selectedPhotos.values()];
  if (photos.length === 0) return;
  
  // 简单实现：创建一个快速选择面板
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:500;display:flex;align-items:center;justify-content:center;';
  
  const panel = document.createElement('div');
  panel.style.cssText = 'background:white;border-radius:8px;padding:16px;max-width:700px;max-height:80vh;overflow-y:auto;';
  panel.innerHTML = '<h3 style="margin-bottom:12px;">选择照片放入此位置</h3>';
  
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px;';
  
  photos.forEach(photo => {
    const card = document.createElement('div');
    card.style.cssText = 'aspect-ratio:1;border-radius:4px;overflow:hidden;cursor:pointer;border:2px solid transparent;transition:border-color 0.2s;';
    
    const img = document.createElement('img');
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
    if (state.thumbnailCache.has(photo.path)) {
      img.src = 'data:image/jpeg;base64,' + state.thumbnailCache.get(photo.path);
    }
    card.appendChild(img);
    
    card.addEventListener('click', () => {
      state.albumPages[pageIndex].slots[slotIndex] = { photo, caption: '' };
      document.body.removeChild(overlay);
      renderAlbumPages();
    });
    card.addEventListener('mouseenter', () => card.style.borderColor = 'var(--accent)');
    card.addEventListener('mouseleave', () => card.style.borderColor = 'transparent');
    
    grid.appendChild(card);
  });
  
  panel.appendChild(grid);
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
  
  const zoom = state.previewZoom / 100;
  $('#preview-page-info').textContent = 
    `第 ${state.previewPage + 1} 页 / 共 ${state.albumPages.length} 页`;
  
  const page = state.albumPages[state.previewPage];
  const pageEl = document.createElement('div');
  pageEl.className = 'preview-page';
  const w = 800 * zoom;
  const h = Math.round(800 / 1.414) * zoom;
  pageEl.style.width = w + 'px';
  pageEl.style.height = h + 'px';
  pageEl.style.transform = `scale(${zoom})`;
  pageEl.style.transformOrigin = 'top center';
  
  // 简化的预览渲染
  const layoutCfg = LAYOUTS[page.layout] || LAYOUTS['full'];
  pageEl.style.display = 'grid';
  pageEl.style.gridTemplateColumns = layoutCfg.cols;
  pageEl.style.gridTemplateRows = layoutCfg.rows;
  pageEl.style.gap = '8px';
  pageEl.style.padding = '8px';
  
  for (const slot of page.slots) {
    const slotEl = document.createElement('div');
    slotEl.style.cssText = 'background:#f5f5f5;border-radius:4px;overflow:hidden;';
    if (slot && slot.photo) {
      const img = document.createElement('img');
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      if (state.thumbnailCache.has(slot.photo.path)) {
        img.src = 'data:image/jpeg;base64,' + state.thumbnailCache.get(slot.photo.path);
      }
      slotEl.appendChild(img);
    }
    pageEl.appendChild(slotEl);
  }
  
  canvas.appendChild(pageEl);
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
$('#btn-save').addEventListener('click', async () => {
  const projectData = {
    rootDir: state.rootDir,
    selectedPhotos: [...state.selectedPhotos.values()],
    albumPages: state.albumPages,
    version: '1.0'
  };
  
  const path = await window.electronAPI.saveProject(projectData);
  if (path) {
    showToast('项目已保存：' + path);
  }
});

$('#btn-open').addEventListener('click', async () => {
  const data = await window.electronAPI.openProject();
  if (!data) return;
  
  state.rootDir = data.rootDir;
  state.selectedPhotos = new Map();
  for (const p of data.selectedPhotos) {
    state.selectedPhotos.set(p.path, p);
  }
  state.albumPages = data.albumPages || [];
  
  if (state.rootDir) {
    $('#dir-path').textContent = state.rootDir;
    state.photoData = await window.electronAPI.scanPhotos(state.rootDir);
    renderYearNav();
  }
  
  updateSelectedCount();
  renderSelectedPanel();
  renderAlbumPages();
  showToast('项目已加载');
});

// ==================== 导出 ====================
$('#btn-export').addEventListener('click', () => {
  if (state.albumPages.length === 0) {
    showToast('请先完成排版再导出');
    return;
  }
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
  const includeBleed = $('#export-bleed').checked;
  const includeCover = $('#export-cover').checked;
  
  showLoading('正在生成导出文件...');
  
  try {
    if (format === 'pdf') {
      await exportToPdf(paperSize, includeBleed, includeCover);
    } else {
      await exportToImages(paperSize, includeBleed, includeCover);
    }
  } catch (e) {
    showToast('导出失败：' + e.message);
  }
  
  hideLoading();
});

async function exportToPdf(paperSize, includeBleed, includeCover) {
  const filePath = await window.electronAPI.exportPdf({ paperSize });
  if (!filePath) { hideLoading(); return; }
  
  const { jsPDF } = window.jspdf;
  
  // 设置页面尺寸 (单位: mm)
  const sizes = {
    'a4': [210, 297],
    'a4-landscape': [297, 210],
    'a3': [297, 420],
    'square': [210, 210],
    '8x10': [203, 254],
    '12x12': [305, 305]
  };
  
  const [pageW, pageH] = sizes[paperSize] || sizes['a4-landscape'];
  const pdf = new jsPDF({
    orientation: pageW > pageH ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [pageW, pageH]
  });
  
  // 渲染每一页
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-9999px;top:0;';
  document.body.appendChild(container);
  
  for (let i = 0; i < state.albumPages.length; i++) {
    const page = state.albumPages[i];
    
    // 创建临时渲染元素
    const pageEl = document.createElement('div');
    const renderW = 1600; // 高分辨率渲染
    const renderH = Math.round(renderW / (pageW / pageH));
    pageEl.style.width = renderW + 'px';
    pageEl.style.height = renderH + 'px';
    pageEl.style.background = 'white';
    pageEl.style.position = 'relative';
    
    const layoutCfg = LAYOUTS[page.layout] || LAYOUTS['full'];
    const grid = document.createElement('div');
    grid.style.cssText = `
      display: grid;
      grid-template-columns: ${layoutCfg.cols};
      grid-template-rows: ${layoutCfg.rows};
      gap: 8px;
      padding: 16px;
      width: 100%;
      height: 100%;
    `;
    
    for (const slot of page.slots) {
      const slotEl = document.createElement('div');
      slotEl.style.cssText = 'background:#f5f5f5;border-radius:4px;overflow:hidden;';
      if (slot && slot.photo) {
        const img = document.createElement('img');
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        if (state.thumbnailCache.has(slot.photo.path)) {
          img.src = 'data:image/jpeg;base64,' + state.thumbnailCache.get(slot.photo.path);
        }
        slotEl.appendChild(img);
      }
      grid.appendChild(slotEl);
    }
    
    pageEl.appendChild(grid);
    container.appendChild(pageEl);
    
    // 用 html2canvas 渲染
    const canvas = await html2canvas(pageEl, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false
    });
    
    container.removeChild(pageEl);
    
    // 添加到 PDF
    if (i > 0) pdf.addPage([pageW, pageH]);
    
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    pdf.addImage(imgData, 'JPEG', 0, 0, pageW, pageH, undefined, 'FAST');
  }
  
  document.body.removeChild(container);
  
  pdf.save(filePath);
  showToast(`PDF 已导出：${filePath}`);
}

async function exportToImages(paperSize, includeBleed, includeCover) {
  // 使用 html2canvas 逐页导出
  showLoading('正在逐页渲染...');
  
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-9999px;top:0;';
  document.body.appendChild(container);
  
  const sizes = {
    'a4': [210, 297],
    'a4-landscape': [297, 210],
    'a3': [297, 420],
    'square': [210, 210],
    '8x10': [203, 254],
    '12x12': [305, 305]
  };
  
  const [pageW, pageH] = sizes[paperSize] || sizes['a4-landscape'];
  
  for (let i = 0; i < state.albumPages.length; i++) {
    $('#loading-text').textContent = `渲染第 ${i+1}/${state.albumPages.length} 页...`;
    const page = state.albumPages[i];
    
    const pageEl = document.createElement('div');
    const renderW = 2480; // A4 300dpi ≈ 2480px
    const renderH = Math.round(renderW / (pageW / pageH));
    pageEl.style.width = renderW + 'px';
    pageEl.style.height = renderH + 'px';
    pageEl.style.background = 'white';
    
    const layoutCfg = LAYOUTS[page.layout] || LAYOUTS['full'];
    pageEl.style.display = 'grid';
    pageEl.style.gridTemplateColumns = layoutCfg.cols;
    pageEl.style.gridTemplateRows = layoutCfg.rows;
    pageEl.style.gap = '12px';
    pageEl.style.padding = '24px';
    
    for (const slot of page.slots) {
      const slotEl = document.createElement('div');
      slotEl.style.cssText = 'background:#f5f5f5;border-radius:4px;overflow:hidden;display:flex;align-items:center;justify-content:center;';
      if (slot && slot.photo) {
        const img = document.createElement('img');
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        // 尝试加载原图
        try {
          const b64 = await window.electronAPI.getFullImage(slot.photo.path);
          if (b64) {
            img.src = 'data:image/jpeg;base64,' + b64;
          }
        } catch {}
        slotEl.appendChild(img);
      }
      pageEl.appendChild(slotEl);
    }
    
    container.appendChild(pageEl);
    
    const canvas = await html2canvas(pageEl, {
      scale: 1,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false
    });
    
    container.removeChild(pageEl);
    
    // 下载图片
    const link = document.createElement('a');
    link.download = `成长相册_第${String(i+1).padStart(3,'0')}页.jpg`;
    link.href = canvas.toDataURL('image/jpeg', 0.95);
    link.click();
    
    // 小延迟避免浏览器阻止多次下载
    await new Promise(r => setTimeout(r, 300));
  }
  
  document.body.removeChild(container);
  showToast(`已导出 ${state.albumPages.length} 页图片`);
}

// ==================== 初始化 ====================
console.log('📸 成长相册排版软件已就绪');
console.log('使用说明：');
console.log('  1. 点击"选择照片目录"选择 D 盘照片根目录');
console.log('  2. 在选片视图中浏览和精选照片（点击选中，双击预览）');
console.log('  3. 点击"自动排版"生成相册排版');
console.log('  4. 在排版视图中调整布局和照片位置');
console.log('  5. 在预览视图中查看效果');
console.log('  6. 点击"导出打印"输出 PDF 或图片');

// 默认选择 D 盘作为初始目录
// 如果有照片目录，可以自动加载
