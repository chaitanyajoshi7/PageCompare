// content_script.js - Optimized & Feature-Ready Version
(() => {
    // Prevent multiple executions
    if (window.PCE_DATA) return;

    /*** ===========================
     * GLOBAL STATE & CONFIG
     * =========================== */
    window.PCE_DATA = {
        diffCounter: 0,
        sourceTextSet: new Set(),
        sourceLinksHref: new Map(),
        sourceLinksText: new Map(),
        sourceImages: new Set(),
        COLORS: {
            HEADING: '#FFC300',
            PARAGRAPH: '#FFFAA0',
            CTA_TEXT: '#DA70D6',
            LINK: '#FF4136',
            IMAGE: '#82CA9D',
            GENERAL_TEXT: '#E0E0E0',
            REMOVED: '#B0C4DE'
        },
        ICONS: {
            HEADING: '✍️',
            PARAGRAPH: '📄',
            CTA_TEXT: '💬',
            MODIFIED_LINK: '↔️',
            NEW_LINK: '✨',
            IMAGE: '🖼️',
            GENERAL_TEXT: '📝',
            REMOVED: '❌'
        }
    };

    const $ = (id) => document.getElementById(id);

    /*** ===========================
     * MESSAGE LISTENER
     * =========================== */
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.from === "popup" && request.sourceHtml) {
            clearPreviousComparison();
            const parser = new DOMParser();
            const sourceDoc = parser.parseFromString(request.sourceHtml, "text/html");
            comparePages(sourceDoc, document);
            sendResponse({ status: "Comparison initiated" });
        }
        return true;
    });

    /*** ===========================
     * MAIN COMPARISON FUNCTION
     * =========================== */
    function comparePages(sourceDoc, currentDoc) {
        injectUI();
        makeTableSortable($('pce-summary-table'));

        cacheSourceData(sourceDoc);

        // Detect new/changed text
        getTextNodes(currentDoc.body).forEach(node => {
            const text = normalizeText(node.nodeValue);
            if (!window.PCE_DATA.sourceTextSet.has(text)) {
                const parentTag = node.parentElement.tagName.toUpperCase();
                if (/^H[1-6]$/.test(parentTag)) {
                    processDifference(node.parentElement, 'Heading Change', `Text changed in <${parentTag}>`, 'HEADING');
                } else if (parentTag === 'P') {
                    processDifference(node.parentElement, 'Paragraph Change', 'Text changed in <p>', 'PARAGRAPH');
                } else if (!(node.parentElement.closest('a') || node.parentElement.closest('button'))) {
                    processDifference(node.parentElement, 'General Text Change', `Text changed in <${parentTag}>`, 'GENERAL_TEXT');
                }
            }
        });

        // Detect link changes/new links
        Array.from(currentDoc.getElementsByTagName('a')).forEach(link => handleLinkComparison(link, currentDoc));

        // Detect image changes
        Array.from(currentDoc.getElementsByTagName('img')).forEach(img => handleImageComparison(img));

        // Detect removed content (text & links)
        detectRemovedContent(currentDoc);

        // Update UI count
        updateDiffCount();
    }

    /*** ===========================
     * DATA CACHING
     * =========================== */
    function cacheSourceData(sourceDoc) {
        // Cache text
        getTextNodes(sourceDoc.body).forEach(node => {
            window.PCE_DATA.sourceTextSet.add(normalizeText(node.nodeValue));
        });

        // Cache links
        Array.from(sourceDoc.getElementsByTagName('a')).forEach(a => {
            const href = getAbsoluteUrl(sourceDoc, a.href);
            const text = normalizeText(a.innerText);
            window.PCE_DATA.sourceLinksHref.set(href, { href, text });
            if (text) window.PCE_DATA.sourceLinksText.set(text, { href, text });
        });

        // Cache images
        window.PCE_DATA.sourceImages = getAllImageFileNames(sourceDoc);
    }

    /*** ===========================
     * COMPARISON HELPERS
     * =========================== */
    function handleLinkComparison(link, currentDoc) {
        const href = getAbsoluteUrl(currentDoc, link.href);
        const text = normalizeText(link.innerText);

        if (window.PCE_DATA.sourceLinksHref.has(href) && window.PCE_DATA.sourceLinksHref.get(href).text === text) return;

        if (window.PCE_DATA.sourceLinksHref.has(href)) {
            processDifference(link, 'CTA Text Change', `Link text changed from "${window.PCE_DATA.sourceLinksHref.get(href).text}"`, 'CTA_TEXT');
        } else if (window.PCE_DATA.sourceLinksText.has(text)) {
            processDifference(link, 'Modified Link', `URL changed from: ${window.PCE_DATA.sourceLinksText.get(text).href}`, 'MODIFIED_LINK');
        } else {
            processDifference(link, 'New Link', `URL: ${link.href}`, 'NEW_LINK');
        }
    }

    function handleImageComparison(img) {
        const names = new Set([getFinalImageName(img.src), ...parseSrcsetForFileNames(img.srcset)].filter(Boolean));
        if (![...names].some(name => window.PCE_DATA.sourceImages.has(name))) {
            processDifference(img, 'Image Change', `Filename: ${[...names][0] || 'N/A'}`, 'IMAGE');
        }
    }

    function detectRemovedContent(currentDoc) {
        // Removed text
        window.PCE_DATA.sourceTextSet.forEach(text => {
            if (!Array.from(getTextNodes(currentDoc.body)).some(n => normalizeText(n.nodeValue) === text)) {
                processDifference(null, 'Removed Text', `Text removed: "${text}"`, 'REMOVED');
            }
        });

        // Removed links
        window.PCE_DATA.sourceLinksHref.forEach(({ href }) => {
            if (![...currentDoc.getElementsByTagName('a')].some(a => getAbsoluteUrl(currentDoc, a.href) === href)) {
                processDifference(null, 'Removed Link', `URL removed: ${href}`, 'REMOVED');
            }
        });
    }

    /*** ===========================
     * DIFF HANDLING
     * =========================== */
    function processDifference(element, type, details, diffType) {
        window.PCE_DATA.diffCounter++;
        const id = `pce-element-${window.PCE_DATA.diffCounter}`;

        if (element) {
            element.id = id;
            element.setAttribute('data-pce-marked', 'true');
            element.style.cursor = 'pointer';
            styleElementForDiff(element, diffType);
            element.addEventListener('click', e => handleElementClick(e, id));
        }

        addDifferenceToSummaryList(id, type, details, diffType);
    }

    function styleElementForDiff(element, diffType) {
        if (['HEADING', 'PARAGRAPH', 'GENERAL_TEXT', 'CTA_TEXT'].includes(diffType)) {
            element.style.backgroundColor = window.PCE_DATA.COLORS[diffType];
        } else if (['LINK', 'MODIFIED_LINK', 'NEW_LINK'].includes(diffType)) {
            element.style.border = `3px solid ${window.PCE_DATA.COLORS.LINK}`;
            element.style.padding = '2px';
        } else if (diffType === 'IMAGE') {
            const marker = document.createElement('span');
            marker.className = 'pce-marker';
            marker.innerHTML = `<span class="pce-marker-dot pce-flash" style="background-color:${window.PCE_DATA.COLORS.IMAGE};"></span>`;
            element.insertAdjacentElement('afterend', marker);
            marker.addEventListener('click', e => handleElementClick(e, element.id));
        }
    }

    /*** ===========================
     * UI FUNCTIONS
     * =========================== */
    function injectUI() {
        const container = document.createElement('div');
        container.id = 'pce-ui-container';
        container.innerHTML = `
            <div id="pce-summary-panel" class="pce-collapsed">
                <div id="pce-header">
                    <h3>Page Difference Summary (<span id="pce-summary-count">0</span>)</h3>
                    <input type="text" id="pce-search" placeholder="Search changes..." />
                    <button id="pce-toggle-btn">&mdash;</button>
                </div>
                <div id="pce-summary-content">
                    <table id="pce-summary-table" class="pce-sortable">
                        <thead><tr><th>Type</th><th>Category</th><th>Details</th></tr></thead>
                        <tbody id="pce-summary-table-body"></tbody>
                    </table>
                </div>
            </div>
        `;
        document.body.appendChild(container);
        addUIStyles();
        $('pce-toggle-btn').addEventListener('click', () => $('pce-summary-panel').classList.toggle('pce-collapsed'));
        $('pce-search').addEventListener('input', filterSummaryTable);
    }

    function addDifferenceToSummaryList(id, type, details, diffType) {
        const tableBody = $('pce-summary-table-body');
        const row = tableBody.insertRow();
        row.setAttribute('data-element-id', id);
        row.style.backgroundColor = window.PCE_DATA.COLORS[diffType] + '33';
        row.innerHTML = `<td>${window.PCE_DATA.ICONS[diffType] || '❓'}</td><td>${type}</td><td>${details}</td>`;
        row.addEventListener('click', () => {
            const el = $(id);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('pce-focus-highlight');
                setTimeout(() => el.classList.remove('pce-focus-highlight'), 2500);
            }
        });
    }

    function filterSummaryTable() {
        const q = normalizeText(this.value);
        Array.from($('pce-summary-table-body').rows).forEach(row => {
            row.style.display = normalizeText(row.innerText).includes(q) ? '' : 'none';
        });
    }

    function updateDiffCount() {
        const countEl = $('pce-summary-count');
        if (countEl) countEl.textContent = window.PCE_DATA.diffCounter;
        if (window.PCE_DATA.diffCounter > 0) $('pce-summary-panel').classList.remove('pce-collapsed');
    }

    /*** ===========================
     * UTILS
     * =========================== */
    const normalizeText = (t) => (t || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const getAbsoluteUrl = (doc, url) => new URL(url, doc.baseURI).href;
    const getFinalImageName = (url) => { try { return new URL(url, document.baseURI).pathname.split('/').pop(); } catch { return null; } };
    const parseSrcsetForFileNames = (srcset) => (srcset || '').split(',').map(s => getFinalImageName(s.trim().split(/\s+/)[0])).filter(Boolean);
    const getAllImageFileNames = (doc) => { const names = new Set(); Array.from(doc.getElementsByTagName('img')).forEach(img => { const srcName = getFinalImageName(img.src); if (srcName) names.add(srcName); parseSrcsetForFileNames(img.srcset).forEach(name => names.add(name)); }); return names; };
    const getTextNodes = (el) => { const nodes = []; const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (!n.parentElement || n.parentElement.closest('script, style, #pce-ui-container') || !n.nodeValue.trim()) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT }); while (walker.nextNode()) nodes.push(walker.currentNode); return nodes; };
    const clearPreviousComparison = () => { $('pce-ui-container')?.remove(); window.PCE_DATA.diffCounter = 0; };
    const makeTableSortable = (table) => { table.querySelectorAll('th').forEach((header, i) => header.addEventListener('click', () => sortTableByColumn(table, i, !header.classList.contains('sort-asc')))); };
    const sortTableByColumn = (table, col, asc = true) => { const dir = asc ? 1 : -1; const tBody = table.tBodies[0]; const rows = Array.from(tBody.querySelectorAll('tr')); rows.sort((a, b) => a.cells[col].textContent.trim().localeCompare(b.cells[col].textContent.trim()) * dir); tBody.append(...rows); table.querySelectorAll('th').forEach(th => th.classList.remove('sort-asc', 'sort-desc')); table.querySelector(`th:nth-child(${col + 1})`).classList.toggle(asc ? 'sort-asc' : 'sort-desc'); };
    const addUIStyles = () => { const s = document.createElement('style'); s.textContent = `
        .pce-focus-highlight { outline: 3px solid #00BFFF; box-shadow: 0 0 15px rgba(0, 191, 255, 0.7); }
        .pce-marker { display:inline-block; width:16px; height:16px; margin-left:5px; cursor:pointer; }
        .pce-marker-dot { width:100%; height:100%; border-radius:50%; border:1px solid white; box-shadow:0 0 5px rgba(0,0,0,0.7); }
        @keyframes pce-flash { 50% { box-shadow:0 0 8px 3px #fff; opacity:0.5; } }
        .pce-flash { animation:pce-flash 1s infinite; }
        #pce-summary-panel { position:fixed; top:10px; right:10px; width:550px; max-width:90vw; background:white; border-radius:8px; box-shadow:0 4px 15px rgba(0,0,0,0.2); z-index:999999; }
        #pce-summary-panel.pce-collapsed { transform:translateX(calc(100% - 60px)); }
        #pce-header { display:flex; align-items:center; gap:8px; background:#005A9C; color:white; padding:8px; }
        #pce-header input { flex:1; padding:4px; border:none; border-radius:4px; }
        #pce-summary-table { width:100%; border-collapse:collapse; font-size:12px; }
        #pce-summary-table th, #pce-summary-table td { padding:6px; border-bottom:1px solid #ddd; }
        #pce-summary-table tbody tr:hover { background:#e9f5ff; }
    `; document.head.appendChild(s); };
})();
