// content_script.js

// --- NEW: Initialize a single global object to prevent re-declaration errors ---
if (typeof window.PCE_DATA === 'undefined') {
    window.PCE_DATA = {};
}

// Define constants and counters on the global object
window.PCE_DATA.ICONS = {
    HEADING: '✍️',
    PARAGRAPH: '📄',
    CTA_TEXT: '💬',
    MODIFIED_LINK: '↔️',
    NEW_LINK: '✨',
    IMAGE: '🖼️',
    GENERAL_TEXT: '📝'
};

window.PCE_DATA.COLORS = {
    HEADING: '#FFC300',
    PARAGRAPH: '#FFFAA0',
    CTA_TEXT: '#DA70D6',
    LINK: '#FF4136',
    IMAGE: '#82CA9D',
    GENERAL_TEXT: '#E0E0E0'
};

// The difference counter is now part of the global object
window.PCE_DATA.diffCounter = 0;


chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.from === "popup" && request.sourceHtml) {
        clearPreviousComparison();
        const parser = new DOMParser();
        const sourceDoc = parser.parseFromString(request.sourceHtml, "text/html");
        comparePages(sourceDoc, document);
        sendResponse({status: "Comparison initiated"});
    }
    return true; 
});

function comparePages(sourceDoc, currentDoc) {
    injectUI();
    makeTableSortable(document.getElementById('pce-summary-table'));

    // --- Granular Text Comparison ---
    const sourceTextContent = new Set(getTextNodes(sourceDoc.body).map(node => node.nodeValue.trim()));
    getTextNodes(currentDoc.body).forEach(node => {
        if (!sourceTextContent.has(node.nodeValue.trim())) {
            const parent = node.parentElement;
            const parentTag = parent.tagName.toUpperCase();
            if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(parentTag)) {
                processDifference(parent, 'Heading Change', `Text changed in <${parentTag}>`, 'HEADING');
            } else if (parentTag === 'P') {
                processDifference(parent, 'Paragraph Change', 'Text changed in <p>', 'PARAGRAPH');
            } else if (parent.closest('a') || parent.closest('button')) {
                // Handled by link logic
            } else {
                processDifference(parent, 'General Text Change', `Text changed in <${parentTag}>`, 'GENERAL_TEXT');
            }
        }
    });

    // --- Granular Link & CTA Comparison ---
    const getAbsoluteUrl = (doc, relativeUrl) => new URL(relativeUrl, doc.baseURI).href;
    const sourceLinks = Array.from(sourceDoc.getElementsByTagName('a')).map(a => ({href: getAbsoluteUrl(sourceDoc, a.href), text: a.innerText.trim()}));
    Array.from(currentDoc.getElementsByTagName('a')).forEach(currentLink => {
        const currentLinkAbsoluteHref = getAbsoluteUrl(currentDoc, currentLink.href);
        const currentLinkText = currentLink.innerText.trim();
        const perfectMatch = sourceLinks.find(sl => sl.href === currentLinkAbsoluteHref && sl.text === currentLinkText);
        if (perfectMatch) return;
        const linkWithSameHref = sourceLinks.find(sl => sl.href === currentLinkAbsoluteHref);
        if (linkWithSameHref) {
            processDifference(currentLink, 'CTA Text Change', `Link text changed from "${linkWithSameHref.text}"`, 'CTA_TEXT');
            return;
        }
        const linkWithSameText = sourceLinks.find(sl => sl.text === currentLinkText && currentLinkText !== "");
        if (linkWithSameText) {
            processDifference(currentLink, 'Modified Link', `URL changed from: ${linkWithSameText.href}`, 'MODIFIED_LINK');
            return;
        }
        processDifference(currentLink, 'New Link', `URL: ${currentLink.href}`, 'NEW_LINK');
    });

    // --- Image Comparison by Filename ---
    const sourceImageNames = getAllImageFileNames(sourceDoc);
    const currentImages = Array.from(currentDoc.getElementsByTagName('img'));
    currentImages.forEach(imgElement => {
        const currentImageFileNames = new Set([getFinalImageName(imgElement.src), ...parseSrcsetForFileNames(imgElement.srcset)].filter(Boolean));
        if (currentImageFileNames.size === 0) return;
        const isNew = ![...currentImageFileNames].some(fileName => sourceImageNames.has(fileName));
        if (isNew) {
            processDifference(imgElement, 'Image Change', `Filename: ${[...currentImageFileNames][0] || 'N/A'}`, 'IMAGE');
        }
    });

    // Finalize UI
    const panel = document.getElementById('pce-summary-panel');
    const countSpan = document.getElementById('pce-summary-count');
    if (countSpan) countSpan.textContent = window.PCE_DATA.diffCounter;
    if (window.PCE_DATA.diffCounter > 0 && panel) panel.classList.remove('pce-collapsed');
}

function processDifference(element, type, details, diffType) {
    if (!element || !element.parentNode || element.hasAttribute('data-pce-marked')) return;
    
    window.PCE_DATA.diffCounter++;
    const elementId = `pce-element-${window.PCE_DATA.diffCounter}`;
    element.setAttribute('id', elementId);
    element.setAttribute('data-pce-marked', 'true');
    element.style.cursor = 'pointer';

    if (['HEADING', 'PARAGRAPH', 'GENERAL_TEXT', 'CTA_TEXT'].includes(diffType)) {
        element.style.backgroundColor = window.PCE_DATA.COLORS[diffType];
    } else if (['LINK', 'MODIFIED_LINK', 'NEW_LINK'].includes(diffType)) {
        element.style.border = `3px solid ${window.PCE_DATA.COLORS.LINK}`;
        element.style.padding = '2px';
    } else if (diffType === 'IMAGE') {
        const marker = document.createElement('span');
        marker.className = `pce-marker`;
        marker.innerHTML = `<span class="pce-marker-dot pce-flash" style="background-color:${window.PCE_DATA.COLORS.IMAGE};"></span>`;
        element.parentNode.insertBefore(marker, element.nextSibling);
        marker.addEventListener('click', (e) => handleElementClick(e, elementId));
    }
    addDifferenceToSummaryList(elementId, type, details, diffType);
    element.addEventListener('click', (e) => handleElementClick(e, elementId));
}

function handleElementClick(event, elementId) {
    event.preventDefault();
    event.stopPropagation();
    const panel = document.getElementById('pce-summary-panel');
    if (panel.classList.contains('pce-collapsed')) {
        panel.classList.remove('pce-collapsed');
    }
    const row = document.querySelector(`tr[data-element-id='${elementId}']`);
    if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.add('pce-row-highlight');
        setTimeout(() => row.classList.remove('pce-row-highlight'), 2500);
    }
}

function addDifferenceToSummaryList(elementId, type, details, diffType) {
    const tableBody = document.getElementById('pce-summary-table-body');
    const row = tableBody.insertRow();
    row.setAttribute('data-element-id', elementId);
    row.title = 'Click to scroll to this difference';
    row.style.cursor = 'pointer';
    
    const icon = window.PCE_DATA.ICONS[diffType] || '❓';

    row.innerHTML = `
        <td class="pce-icon-cell" title="${type}">${icon}</td>
        <td>${type}</td>
        <td>${details}</td>
    `;
    row.addEventListener('click', () => {
        const targetElement = document.getElementById(elementId);
        if (targetElement) {
            targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetElement.classList.add('pce-focus-highlight');
            setTimeout(() => targetElement.classList.remove('pce-focus-highlight'), 2500);
        }
    });
}

function injectUI() {
    const uiContainer = document.createElement('div');
    uiContainer.id = 'pce-ui-container';
    uiContainer.innerHTML = `
        <div id="pce-summary-panel" class="pce-collapsed">
            <div id="pce-header">
                <h3>Page Difference Summary (<span id="pce-summary-count">0</span>)</h3>
                <button id="pce-toggle-btn" title="Toggle Summary Panel">&mdash;</button>
            </div>
            <div id="pce-summary-content">
                <table id="pce-summary-table" class="pce-sortable">
                    <thead><tr><th>Type</th><th>Category</th><th>Details</th></tr></thead>
                    <tbody id="pce-summary-table-body"></tbody>
                </table>
            </div>
        </div>
    `;
    document.body.appendChild(uiContainer);
    const style = document.createElement('style');
    style.id = 'pce-styles';
    style.textContent = `
        @keyframes pce-flash { 50% { box-shadow: 0 0 8px 3px #fff; opacity: 0.5; } }
        .pce-focus-highlight { outline: 3px solid #00BFFF !important; box-shadow: 0 0 15px rgba(0, 191, 255, 0.7) !important; transition: outline 0.3s ease-in-out, box-shadow 0.3s ease-in-out; }
        .pce-row-highlight { background-color: #aee7ff !important; }
        .pce-marker { display: inline-block; vertical-align: middle; width: 16px; height: 16px; margin-left: 5px; cursor: pointer; }
        .pce-marker-dot { display: block; width: 100%; height: 100%; border-radius: 50%; border: 1px solid white; box-shadow: 0 0 5px rgba(0,0,0,0.7); }
        .pce-flash { animation: pce-flash 1s infinite; }
        #pce-summary-panel { position: fixed; top: 10px; right: 10px; width: 550px; max-width: 90vw; background: white; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); z-index: 2147483647; transition: transform 0.3s ease-in-out; }
        #pce-summary-panel.pce-collapsed { transform: translateX(calc(100% - 60px)); }
        #pce-summary-panel.pce-collapsed #pce-summary-content { display: none; }
        #pce-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; background-color: #005A9C; color: white; border-top-left-radius: 8px; border-top-right-radius: 8px; }
        #pce-header h3 { margin: 0; font-family: sans-serif; font-size: 16px; }
        #pce-toggle-btn { background: none; border: 1px solid white; color: white; cursor: pointer; font-size: 18px; line-height: 1; padding: 2px 8px; border-radius: 4px; }
        #pce-summary-content { max-height: 50vh; overflow-y: auto; padding: 0; }
        #pce-summary-table { width: 100%; border-collapse: collapse; font-family: sans-serif; font-size: 12px; }
        #pce-summary-table thead th { position: sticky; top: 0; background-color: #f2f2f2; z-index: 10; cursor: pointer; user-select: none; }
        #pce-summary-table thead th:hover { background-color: #e0e0e0; }
        #pce-summary-table thead th.sort-asc::after { content: '▲'; }
        #pce-summary-table thead th.sort-desc::after { content: '▼'; }
        #pce-summary-table th, #pce-summary-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #ddd; }
        #pce-summary-table td:nth-child(3) { word-break: break-all; }
        #pce-summary-table tbody tr { transition: background-color 0.2s; }
        #pce-summary-table tbody tr:hover { background-color: #e9f5ff; }
        .pce-icon-cell { font-size: 18px; text-align: center; width: 40px; }
    `;
    document.head.appendChild(style);
    document.getElementById('pce-toggle-btn').addEventListener('click', () => {
        document.getElementById('pce-summary-panel').classList.toggle('pce-collapsed');
    });
}
function getFinalImageName(url) { if (!url || typeof url !== 'string') return null; try { const path = new URL(url, document.baseURI).pathname; return path.substring(path.lastIndexOf('/') + 1); } catch (e) { return null; } }
function getAllImageFileNames(doc) { const names = new Set(); Array.from(doc.getElementsByTagName('img')).forEach(img => { const srcName = getFinalImageName(img.src); if (srcName) names.add(srcName); parseSrcsetForFileNames(img.srcset).forEach(name => names.add(name)); }); return names; }
function parseSrcsetForFileNames(srcset) { if (!srcset) return []; return srcset.split(',').map(part => { const url = part.trim().split(/\s+/)[0]; return getFinalImageName(url); }).filter(Boolean); }
function clearPreviousComparison() { document.getElementById('pce-ui-container')?.remove(); if (window.PCE_DATA) { window.PCE_DATA.diffCounter = 0; } }
function getTextNodes(element) { const textNodes = []; const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, { acceptNode: function(node) { if (!node.parentElement || node.parentElement.closest('script, style, #pce-ui-container') || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT; return NodeFilter.FILTER_ACCEPT; } }); while (node = walker.nextNode()) textNodes.push(node); return textNodes; }
function makeTableSortable(table) { const headers = table.querySelectorAll('th'); headers.forEach((header, index) => { header.addEventListener('click', () => { const isAscending = header.classList.contains('sort-asc'); sortTableByColumn(table, index, !isAscending); }); }); }
function sortTableByColumn(table, columnIndex, ascending = true) { const direction = ascending ? 1 : -1; const tBody = table.tBodies[0]; const rows = Array.from(tBody.querySelectorAll('tr')); const sortedRows = rows.sort((a, b) => { const aColText = a.querySelector(`td:nth-child(${columnIndex + 1})`).textContent.trim().toLowerCase(); const bColText = b.querySelector(`td:nth-child(${columnIndex + 1})`).textContent.trim().toLowerCase(); return aColText > bColText ? (1 * direction) : (-1 * direction); }); while (tBody.firstChild) { tBody.removeChild(tBody.firstChild); } tBody.append(...sortedRows); table.querySelectorAll('th').forEach(th => th.classList.remove('sort-asc', 'sort-desc')); table.querySelector(`th:nth-child(${columnIndex + 1})`).classList.toggle(ascending ? 'sort-asc' : 'sort-desc'); }