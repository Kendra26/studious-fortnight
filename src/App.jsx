import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  findJsonSpans,
  describeSpan,
  findArraysDeep,
  pathLabel,
  getAtPath,
  setAtPath,
  applyDateTimeSortingDeep,
  formatJSON,
} from './lib/jsonTools.js';
import { baserowGet, baserowSet, baserowDelete } from './lib/baserow.js';

const LOCAL_SESSION_KEY = 'json_extract_multi_session';

function makeTab(name) {
  return {
    id: 'tab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name: name || 'Paste 1',
    rawInput: '',
    selectedSpanIdx: 0,
    activeArrayIndex: -1,
    keyword: '',
    selectedMatch: null,
    trimmedValue: null,
    viewMode: 'extracted',
    sortDirection: 'none',
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export default function App() {
  const [tabs, setTabs] = useState(() => [makeTab('Paste 1')]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id);
  const [minify, setMinify] = useState(false);
  const [includeSelf, setIncludeSelf] = useState(true);

  const [cloudConfigured, setCloudConfigured] = useState(null); // null = unknown yet, true/false once checked
  const [cloudIndicator, setCloudIndicator] = useState('Checking cloud storage configuration…');
  const [cloudIndicatorErr, setCloudIndicatorErr] = useState(false);
  const [syncFlash, setSyncFlash] = useState({ msg: '', kind: '' });

  const [extractStatus, setExtractStatus] = useState({ msg: '', kind: '' });
  const [searchStatus, setSearchStatus] = useState({ msg: '', kind: '' });
  const [trimStatus, setTrimStatus] = useState({ msg: '', kind: '' });
  const [outputStatus, setOutputStatus] = useState({ msg: '', kind: '' });

  const rawInputRef = useRef(null);
  const saveTimerRef = useRef(null);
  const loadedRef = useRef(false);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  function updateTab(id, patch) {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }
  function updateActiveTab(patch) {
    updateTab(activeTabId, patch);
  }

  // ---- derived values for the active tab ----
  const spans = useMemo(() => {
    if (!activeTab?.rawInput?.trim()) return [];
    return findJsonSpans(activeTab.rawInput).sort((a, b) => b.length - a.length);
  }, [activeTab?.rawInput]);

  const selectedSpanIdx = spans.length && activeTab.selectedSpanIdx < spans.length ? activeTab.selectedSpanIdx : 0;
  const currentValue = spans.length ? spans[selectedSpanIdx].value : null;

  const arraysFound = useMemo(() => (currentValue ? findArraysDeep(currentValue) : []), [currentValue]);

  const defaultArrayIndex = useMemo(() => {
    if (arraysFound.length === 0) return -1;
    let idx = 0, maxLen = -1;
    arraysFound.forEach((a, i) => { if (a.arr.length > maxLen) { maxLen = a.arr.length; idx = i; } });
    return idx;
  }, [arraysFound]);

  const activeArrayIndex = activeTab.activeArrayIndex >= 0 && activeTab.activeArrayIndex < arraysFound.length
    ? activeTab.activeArrayIndex
    : defaultArrayIndex;
  const activeArrayPath = activeArrayIndex >= 0 ? arraysFound[activeArrayIndex].path : [];
  const activeArray = activeArrayIndex >= 0 ? getAtPath(currentValue, activeArrayPath) : null;

  const keyword = activeTab.keyword || '';
  const matches = useMemo(() => {
    if (!activeArray || !keyword.trim()) return [];
    const kw = keyword.trim().toLowerCase();
    const out = [];
    activeArray.forEach((item, idx) => {
      if (JSON.stringify(item).toLowerCase().includes(kw)) out.push(idx);
    });
    return out;
  }, [activeArray, keyword]);

  const displayValue = activeTab.viewMode === 'trimmed' ? activeTab.trimmedValue : currentValue;
  const sortedDisplayValue = useMemo(
    () => applyDateTimeSortingDeep(displayValue, activeTab.sortDirection),
    [displayValue, activeTab.sortDirection]
  );

  // ---- actions ----
  function doExtract(rawText) {
    const text = rawText !== undefined ? rawText : activeTab.rawInput;
    if (!text.trim()) {
      setExtractStatus({ msg: 'Paste something first.', kind: 'err' });
      return false;
    }
    const found = findJsonSpans(text);
    if (found.length === 0) {
      setExtractStatus({ msg: 'No valid JSON found in that text.', kind: 'err' });
      return false;
    }
    setExtractStatus({ msg: `Found ${found.length} JSON block${found.length === 1 ? '' : 's'}. Largest one is selected below.`, kind: 'ok' });
    updateActiveTab({ selectedSpanIdx: 0 });
    return true;
  }

  function selectSpan(idx) {
    updateActiveTab({ selectedSpanIdx: idx, trimmedValue: null, viewMode: 'extracted', activeArrayIndex: -1, keyword: '', selectedMatch: null });
  }

  function selectArrayOption(idx) {
    updateActiveTab({ activeArrayIndex: idx, keyword: '', selectedMatch: null });
    setSearchStatus({ msg: `Ready to search ${arraysFound[idx].arr.length} item${arraysFound[idx].arr.length === 1 ? '' : 's'} in ${pathLabel(arraysFound[idx].path)}.`, kind: '' });
    setTrimStatus({ msg: '', kind: '' });
  }

  function runSearch() {
    if (!activeArray) return;
    if (!keyword.trim()) {
      setSearchStatus({ msg: 'Type a keyword first.', kind: 'err' });
      return;
    }
    if (matches.length === 0) {
      setSearchStatus({ msg: 'No items matched that keyword.', kind: 'err' });
      updateActiveTab({ selectedMatch: null });
      return;
    }
    setSearchStatus({
      msg: `${matches.length} match${matches.length === 1 ? '' : 'es'} found${matches.length > 1 ? ' — pick the exact one below for position-based trims:' : '.'}`,
      kind: 'ok',
    });
    if (matches.length === 1) updateActiveTab({ selectedMatch: matches[0] });
  }

  function selectMatch(idx) {
    updateActiveTab({ selectedMatch: idx });
    setTrimStatus({ msg: '', kind: '' });
  }

  function finalizeTrim(result, msg) {
    const updatedBlock = setAtPath(currentValue, activeArrayPath, result);
    const newRaw = formatJSON(updatedBlock, minify);
    updateActiveTab({ rawInput: newRaw, selectedSpanIdx: 0, activeArrayIndex: -1, keyword: '', selectedMatch: null });
    const ok = doExtract(newRaw);
    if (ok) setTrimStatus({ msg: `${msg} Loopback complete — Step 1 updated with the new payload seamlessly!`, kind: 'ok' });
  }

  function removeOnly() {
    if (activeTab.selectedMatch === null || !activeArray) return;
    const k = activeTab.selectedMatch;
    finalizeTrim(activeArray.slice(0, k).concat(activeArray.slice(k + 1)), `Removed item index #${k}.`);
  }
  function removeAllMatches() {
    if (matches.length === 0 || !activeArray) return;
    const removeSet = new Set(matches);
    finalizeTrim(activeArray.filter((_, idx) => !removeSet.has(idx)), `Removed ${matches.length} matching items.`);
  }
  function applyRangeTrim(direction) {
    if (activeTab.selectedMatch === null || !activeArray) return;
    const k = activeTab.selectedMatch;
    let result;
    if (direction === 'down') result = includeSelf ? activeArray.slice(0, k) : activeArray.slice(0, k + 1);
    else result = includeSelf ? activeArray.slice(k + 1) : activeArray.slice(k);
    finalizeTrim(result, `Removed ${activeArray.length - result.length} items via structural slicing.`);
  }
  function resetTrim() {
    updateActiveTab({ trimmedValue: null, viewMode: 'extracted' });
    setTrimStatus({ msg: 'Trim reset.', kind: '' });
  }

  function copyOutput() {
    const text = formatJSON(sortedDisplayValue, minify);
    navigator.clipboard.writeText(text).then(
      () => flash(setOutputStatus, 'Copied to clipboard.', 'ok'),
      () => flash(setOutputStatus, 'Clipboard blocked — select the text manually.', 'err')
    );
  }
  function downloadOutput() {
    const text = formatJSON(sortedDisplayValue, minify);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeTab.viewMode === 'trimmed' ? 'trimmed.json' : 'extracted.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    flash(setOutputStatus, 'Download started.', 'ok');
  }
  function flash(setter, msg, kind) {
    setter({ msg, kind });
    setTimeout(() => setter((cur) => (cur.msg === msg ? { msg: '', kind: '' } : cur)), 3000);
  }

  function cycleSortDirection() {
    const order = { none: 'desc', desc: 'asc', asc: 'none' };
    updateActiveTab({ sortDirection: order[activeTab.sortDirection] || 'none' });
  }
  function sortButtonLabel() {
    if (activeTab.sortDirection === 'desc') return '📅 Sort: Newest First';
    if (activeTab.sortDirection === 'asc') return '📅 Sort: Oldest First';
    return '📅 Sort: Default';
  }

  // ---- workspace tab management ----
  function addWorkspaceTab() {
    const t = makeTab(`Paste ${tabs.length + 1}`);
    setTabs((prev) => [...prev, t]);
    setActiveTabId(t.id);
  }
  function switchWorkspaceTab(id) {
    setActiveTabId(id);
  }
  function deleteWorkspaceTab(id) {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1 || prev.length <= 1) return prev;
      const next = prev.filter((t) => t.id !== id);
      if (activeTabId === id) {
        const nextActive = next[idx === 0 ? 0 : idx - 1] || next[0];
        setActiveTabId(nextActive.id);
      }
      return next;
    });
  }
  function renameWorkspaceTab(id, currentName) {
    const renamed = window.prompt('Enter new tab name:', currentName);
    if (renamed !== null && renamed.trim() !== '') updateTab(id, { name: renamed.trim() });
  }
  function clearActiveTabInput() {
    updateActiveTab({ rawInput: '', selectedSpanIdx: 0, activeArrayIndex: -1, keyword: '', selectedMatch: null, trimmedValue: null, sortDirection: 'none' });
    setExtractStatus({ msg: '', kind: '' });
  }

  // ---- persistence: Baserow cloud sync with localStorage fallback ----
  const sessionPayload = useMemo(() => ({ tabs, activeTabId, minify, savedAt: Date.now() }), [tabs, activeTabId, minify]);

  function fallbackLocalSave(data) {
    try {
      localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(data));
      setCloudIndicator('Saved locally fallback at ' + new Date(data.savedAt).toLocaleTimeString() + ' (Baserow not configured).');
      setCloudIndicatorErr(false);
    } catch (e) {
      setCloudIndicator('Autosave failed: storage quota exceeded.');
      setCloudIndicatorErr(true);
    }
  }

  async function saveSession(data) {
    // Always try the server first — the Cloudflare Pages Function tells us whether
    // Baserow credentials are configured (env vars), and only falls back
    // to local storage here if they aren't, or if the request errors out.
    try {
      setCloudIndicator('Syncing…');
      setCloudIndicatorErr(false);
      const result = await baserowSet({ sessionKey: LOCAL_SESSION_KEY, value: JSON.stringify(data) });
      if (result.configured === false) {
        setCloudConfigured(false);
        fallbackLocalSave(data);
        return;
      }
      setCloudConfigured(true);
      setCloudIndicator('Cloud autosaved to Baserow at ' + new Date(data.savedAt).toLocaleTimeString() + '.');
      setCloudIndicatorErr(false);
    } catch (e) {
      setCloudIndicator('Cloud upload failed: ' + (e.message || 'unknown error') + '. Saving locally instead…');
      setCloudIndicatorErr(true);
      fallbackLocalSave(data);
    }
  }

  useEffect(() => {
    if (!loadedRef.current) return; // don't autosave until initial load finished
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveSession(sessionPayload), 700);
    return () => clearTimeout(saveTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionPayload]);

  async function fetchFromBaserowExplicitly() {
    try {
      setSyncFlash({ msg: 'Contacting Baserow…', kind: '' });
      const { configured, value: raw } = await baserowGet({ sessionKey: LOCAL_SESSION_KEY });
      if (!configured) {
        setCloudConfigured(false);
        flash(setSyncFlash, 'Cloud storage isn\u2019t configured on the server yet (set BASEROW_API_TOKEN / BASEROW_TABLE_ID env vars).', 'err');
        return;
      }
      setCloudConfigured(true);
      if (raw) {
        const data = JSON.parse(raw);
        applyLoadedSession(data);
        flash(setSyncFlash, 'Cloud workspace loaded successfully!', 'ok');
        setCloudIndicator('Synchronized with Baserow.');
        setCloudIndicatorErr(false);
      } else {
        flash(setSyncFlash, 'No saved session found on that table yet. Saving current state…', 'err');
        saveSession(sessionPayload);
      }
    } catch (e) {
      flash(setSyncFlash, `Sync failed: ${e.message}`, 'err');
    }
  }

  function applyLoadedSession(data) {
    if (typeof data.minify === 'boolean') setMinify(data.minify);
    if (data.tabs && data.tabs.length > 0) {
      setTabs(data.tabs);
      setActiveTabId(data.activeTabId || data.tabs[0].id);
    }
  }

  async function clearSavedSession() {
    if (cloudConfigured) {
      if (window.confirm('Wipe the saved session row on Baserow?')) {
        try {
          await baserowDelete({ sessionKey: LOCAL_SESSION_KEY });
          flash(setExtractStatus, 'Cloud session row cleared.', 'ok');
        } catch (e) {
          flash(setExtractStatus, 'Failed to clear cloud record.', 'err');
        }
      }
    }
    try { localStorage.removeItem(LOCAL_SESSION_KEY); } catch (e) {}
    const t = makeTab('Paste 1');
    setTabs([t]);
    setActiveTabId(t.id);
    setCloudIndicator('Empty clean slate initialized.');
    setCloudIndicatorErr(false);
  }

  // initial load
  useEffect(() => {
    (async () => {
      let loadedFromCloud = false;
      try {
        setCloudIndicator('Connecting to Baserow…');
        const { configured, value: raw } = await baserowGet({ sessionKey: LOCAL_SESSION_KEY });
        setCloudConfigured(configured);
        if (configured && raw) {
          applyLoadedSession(JSON.parse(raw));
          setCloudIndicator('Cloud synchronization ready.');
          loadedFromCloud = true;
        } else if (!configured) {
          setCloudIndicator('Cloud storage not configured on the server \u2014 using local browser storage.');
        }
      } catch (e) {
        console.error('Initial Baserow load failed, falling back to local cache', e);
        setCloudConfigured(false);
      }

      if (!loadedFromCloud) {
        try {
          const saved = localStorage.getItem(LOCAL_SESSION_KEY);
          if (saved) {
            applyLoadedSession(JSON.parse(saved));
            setCloudIndicator('Loaded backup context from local browser cache.');
          } else if (cloudConfigured !== false) {
            setCloudIndicator('Empty clean slate initialized.');
          }
        } catch (e) {
          setCloudIndicator('Empty clean slate initialized.');
        }
      }
      loadedRef.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!activeTab) return null;

  return (
    <>
      <div className="blob blob1"></div>
      <div className="blob blob2"></div>
      {['f1','f2','f3','f4','f5','f6','f7','f8','f9','f10','f11','f12'].map((f, i) => (
        <div key={f} className={`floaty ${f}`}>{i % 3 === 1 ? '✨' : '🦄'}</div>
      ))}
      <div className="wrap">
        <div className="eyebrow">✨ extract --input=raw.http --mode=json 🦄</div>
        <div className="title-row">
          <svg className="mascot" viewBox="0 0 120 120" width="56" height="56" aria-hidden="true">
            <defs>
              <linearGradient id="maneGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#ff9fd6" />
                <stop offset="45%" stopColor="#c6a8ff" />
                <stop offset="100%" stopColor="#9ff2d6" />
              </linearGradient>
              <linearGradient id="hornGrad" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="#ffc94d" />
                <stop offset="100%" stopColor="#fff3cf" />
              </linearGradient>
            </defs>
            <polygon points="66,10 74,42 58,42" fill="url(#hornGrad)" stroke="#e8a93a" strokeWidth="1.5" strokeLinejoin="round" />
            <line x1="61" y1="26" x2="71" y2="28" stroke="#e8a93a" strokeWidth="1.5" />
            <line x1="63" y1="34" x2="70" y2="35" stroke="#e8a93a" strokeWidth="1.5" />
            <path d="M40 34 C 20 30, 14 52, 26 62 C 12 66, 14 86, 30 88 C 22 96, 32 108, 46 102 C 44 110, 58 112, 62 102" fill="url(#maneGrad)" />
            <path d="M50 40 C 40 40, 32 50, 33 62 C 34 74, 44 82, 56 82 C 62 82, 66 78, 70 74 L 82 78 L 74 66 C 76 56, 70 42, 58 40 C 55 39, 52 39, 50 40 Z" fill="#fffaf3" stroke="#e9d9ff" strokeWidth="1.5" />
            <path d="M46 41 L 44 30 L 53 39 Z" fill="#ffe3f4" stroke="#e9d9ff" strokeWidth="1.2" />
            <circle cx="58" cy="58" r="3.2" fill="#3a1d54" />
            <circle cx="49" cy="66" r="4" fill="#ffc9e6" opacity=".7" />
          </svg>
          <h1>json / extract<span className="cursor"></span></h1>
        </div>
        <div className="mane"></div>
        <div className="sub">Paste a raw request/response dump — or a single clean JSON blob. It finds the actual payload buried in headers and noise, digs into any list it contains (even nested ones), and lets you cut items from an exact position or drop just the ones that match a filter.</div>

        {/* Baserow cloud panel */}
        <div className="panel">
          <div className="panel-decorator">☁️</div>
          <div className="panel-title"><span className="n">☁️</span> Cloud Storage <span className="hint">— syncs workspaces live across devices</span></div>
          <div className="row">
            <span className={`status ${cloudConfigured === false ? 'err' : ''}`}>
              {cloudConfigured === null
                ? 'Checking server configuration…'
                : cloudConfigured
                ? 'Connected — credentials are set server-side (Cloudflare Pages env vars).'
                : 'Not configured. Set BASEROW_API_TOKEN and BASEROW_TABLE_ID as environment variables on the server to enable cross-device sync; using local browser storage for now.'}
            </span>
          </div>
          <div className="row">
            <button className="small primary" onClick={fetchFromBaserowExplicitly}>☁️ Force Fetch from Cloud</button>
            <span className={`status ${syncFlash.kind}`}>{syncFlash.msg}</span>
          </div>
        </div>

        {/* Workspace tabs */}
        <div className="workspace-tabs-container">
          {tabs.map((t) => (
            <div key={t.id} className={`w-tab ${t.id === activeTabId ? 'active' : ''}`}>
              <span style={{ cursor: 'pointer' }} onClick={() => switchWorkspaceTab(t.id)}>{t.name}</span>
              <span className="edit-btn" title="Rename tab" onClick={() => renameWorkspaceTab(t.id, t.name)}>✏️</span>
              {tabs.length > 1 && (
                <span className="close-btn" onClick={() => deleteWorkspaceTab(t.id)}>×</span>
              )}
            </div>
          ))}
          <button className="add-tab-btn" onClick={addWorkspaceTab}>+ Add Paste</button>
        </div>

        {/* Step 1: paste */}
        <div className="panel">
          <div className="panel-decorator">🦄</div>
          <div className="panel-title">
            <span className="n">1</span> paste your dump
            <div className="scroller-nav">
              <button className="pink-nav" title="Jump to top of dump" onClick={() => { if (rawInputRef.current) rawInputRef.current.scrollTop = 0; }}><span className="nav-arrow">▲</span> Top</button>
              <button className="pink-nav" title="Jump to end of dump" onClick={() => { if (rawInputRef.current) rawInputRef.current.scrollTop = rawInputRef.current.scrollHeight; }}><span className="nav-arrow">▼</span> Bottom</button>
            </div>
          </div>
          <textarea
            ref={rawInputRef}
            placeholder="Paste the full HTTP request/response text (or plain JSON) here..."
            value={activeTab.rawInput}
            onChange={(e) => updateActiveTab({ rawInput: e.target.value })}
          />
          <div className="row">
            <button className="primary" onClick={() => doExtract()}>🦄 Extract JSON</button>
            <button onClick={clearActiveTabInput}>Clear</button>
            <button className="small" onClick={clearSavedSession}>Clear saved session</button>
            <span className={`status ${extractStatus.kind}`}>{extractStatus.msg}</span>
          </div>
        </div>

        {/* Step 2: detected blocks */}
        {spans.length > 0 && (
          <div className="panel">
            <div className="panel-decorator">✨</div>
            <div className="panel-title"><span className="n">2</span> detected json blocks 🦄</div>
            <div className="spans">
              {spans.map((s, idx) => (
                <div key={idx} className={`span-opt ${idx === selectedSpanIdx ? 'active' : ''}`} onClick={() => selectSpan(idx)}>
                  <span className="tag">block {idx + 1}</span>
                  <span>{describeSpan(s)}</span>
                  <span className="len">{s.length.toLocaleString()} chars</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: result */}
        {spans.length > 0 && (
          <div className="panel">
            <div className="panel-decorator">🦄</div>
            <div className="panel-title"><span className="n">3</span> result 🦄</div>
            <div className="tabs">
              <div className={`tab ${activeTab.viewMode === 'extracted' ? 'active' : ''}`} onClick={() => updateActiveTab({ viewMode: 'extracted' })}>extracted</div>
              {activeTab.trimmedValue !== null && (
                <div className={`tab ${activeTab.viewMode === 'trimmed' ? 'active' : ''}`} onClick={() => updateActiveTab({ viewMode: 'trimmed' })}>trimmed</div>
              )}
            </div>
            <div className="meta">
              {Array.isArray(sortedDisplayValue) ? (
                <span><span className="num">{sortedDisplayValue.length}</span> item{sortedDisplayValue.length === 1 ? '' : 's'} in this view.</span>
              ) : sortedDisplayValue && typeof sortedDisplayValue === 'object' ? (
                arraysFound.length > 0
                  ? <span>Object with <span className="num">{arraysFound.length}</span> list{arraysFound.length === 1 ? '' : 's'} found inside — see step 4 to trim {arraysFound.length === 1 ? 'it' : 'one'}.</span>
                  : 'Object — no lists found inside to trim.'
              ) : 'Non-array, non-object JSON — trim-by-keyword is not applicable.'}
            </div>
            <pre className="output">{formatJSON(sortedDisplayValue, minify)}</pre>
            <div className="row">
              <button className="small" onClick={copyOutput}>Copy</button>
              <button className="small" onClick={downloadOutput}>Download .json</button>
              <button className="small" onClick={cycleSortDirection} style={{ borderColor: activeTab.sortDirection === 'desc' ? 'var(--pink)' : activeTab.sortDirection === 'asc' ? 'var(--violet)' : 'var(--border-2)' }}>{sortButtonLabel()}</button>
              <label className="chk"><input type="checkbox" checked={minify} onChange={(e) => setMinify(e.target.checked)} /> minify output</label>
              <span className={`status ${outputStatus.kind}`}>{outputStatus.msg}</span>
            </div>
          </div>
        )}

        {/* Step 4: trim */}
        {arraysFound.length > 0 && (
          <div className="panel">
            <div className="panel-decorator">✨</div>
            <div className="panel-title"><span className="n">4</span> trim a list 🦄 <span className="hint">— works on any array found inside the block, even nested ones</span></div>

            {arraysFound.length > 1 && (
              <>
                <div className="group-label">lists found in this block</div>
                <div className="spans">
                  {arraysFound.map((a, idx) => (
                    <div key={idx} className={`span-opt ${idx === activeArrayIndex ? 'active' : ''}`} onClick={() => selectArrayOption(idx)}>
                      <span className="tag" dangerouslySetInnerHTML={{ __html: escapeHtml(pathLabel(a.path)) }} />
                      <span>{a.arr.length} item{a.arr.length === 1 ? '' : 's'}</span>
                    </div>
                  ))}
                </div>
                <hr className="rule" />
              </>
            )}

            <div className="row">
              <input
                type="text"
                placeholder="keyword to search for (e.g. a title, id, or status)"
                value={keyword}
                onChange={(e) => updateActiveTab({ keyword: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
              />
              <button onClick={runSearch}>🦄 Search</button>
            </div>
            <div className={`status ${searchStatus.kind}`}>{searchStatus.msg}</div>

            <div className="matches">
              {matches.map((idx) => {
                const item = activeArray[idx];
                const label = (item && (item.name || item.id || item.title)) || JSON.stringify(item);
                return (
                  <div key={idx} className={`match-row ${activeTab.selectedMatch === idx ? 'active' : ''}`} onClick={() => selectMatch(idx)}>
                    <span className="idx">#{idx}</span>
                    <span className="name">{String(label)}</span>
                  </div>
                );
              })}
            </div>

            {matches.length > 0 && (
              <div>
                <hr className="rule" />
                <div className="group-label">just the matches</div>
                <div className="row">
                  <button onClick={removeOnly} disabled={activeTab.selectedMatch === null}>Remove this item only</button>
                  <button onClick={removeAllMatches} disabled={matches.length === 0}>Remove all matches ({matches.length})</button>
                </div>
                <div className="group-label">from the selected position</div>
                <div className="row">
                  <label className="chk"><input type="checkbox" checked={includeSelf} onChange={(e) => setIncludeSelf(e.target.checked)} /> include the matched item itself</label>
                </div>
                <div className="row">
                  <button onClick={() => applyRangeTrim('down')} disabled={activeTab.selectedMatch === null}>Remove this item + everything below</button>
                  <button onClick={() => applyRangeTrim('up')} disabled={activeTab.selectedMatch === null}>Remove this item + everything above</button>
                  <button className="small" onClick={resetTrim}>Reset trim</button>
                </div>
                <div className={`status ${trimStatus.kind}`}>{trimStatus.msg}</div>
              </div>
            )}
          </div>
        )}

        <div className="footnote">
          Everything runs on demand — a local cache handles connection settings safely. "Down" means later in the array (as returned by the API); "up" means earlier.<br />
          <span style={{ color: cloudIndicatorErr ? 'var(--red)' : 'var(--muted)' }}>{cloudIndicator}</span>
        </div>
      </div>
    </>
  );
}
