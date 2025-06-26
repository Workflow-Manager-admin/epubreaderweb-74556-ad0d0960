import React, { useEffect, useRef, useState } from "react";
import "./App.css";
import { FaMoon, FaSun, FaSearch, FaBookmark, FaRegBookmark, FaUpload } from "react-icons/fa";
import ePub from "epubjs";
import Fuse from "fuse.js";

// PUBLIC_INTERFACE
function App() {
  // State
  const [theme, setTheme] = useState("light");
  const [accentColor, setAccentColor] = useState("#ffc107");
  const [fontSize, setFontSize] = useState(1);
  const [book, setBook] = useState(null);
  const [rendition, setRendition] = useState(null);
  const [toc, setToc] = useState([]);
  const [currentLoc, setCurrentLoc] = useState("");
  const [currentChapter, setCurrentChapter] = useState("");
  const [fileName, setFileName] = useState("");
  const [bookmarks, setBookmarks] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showToc, setShowToc] = useState(true);

  const mainAreaRef = useRef(null);
  const lastBookKey = "epubreader-bookmarks";
  const lastFontKey = "epubreader-fontsize";
  const lastThemeKey = "epubreader-theme";

  // Apply persisted user settings
  useEffect(() => {
    const storedBookmarks = JSON.parse(localStorage.getItem(lastBookKey));
    const storedFont = Number(localStorage.getItem(lastFontKey));
    const storedTheme = localStorage.getItem(lastThemeKey);
    if (storedBookmarks) setBookmarks(storedBookmarks);
    if (storedFont) setFontSize(storedFont);
    if (storedTheme) handleSetTheme(storedTheme);
    // eslint-disable-next-line
  }, []);

  // Effect to apply theme to document element and accent color
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.setProperty("--accent-color", accentColor);
    document.documentElement.style.setProperty("--reader-primary", "#1e88e5");
    document.documentElement.style.setProperty("--reader-secondary", "#43a047");
    document.documentElement.style.setProperty("--reader-accent", "#ffc107");
    localStorage.setItem(lastThemeKey, theme);
  }, [theme, accentColor]);

  // Update bookmarks or font size in localStorage
  useEffect(() => {
    localStorage.setItem(lastBookKey, JSON.stringify(bookmarks));
  }, [bookmarks]);

  useEffect(() => {
    localStorage.setItem(lastFontKey, fontSize);
    if (rendition) {
      rendition.themes.fontSize(`${fontSize * 100}%`);
    }
  }, [fontSize, rendition]);

  // Initialize EPUB rendering when book is loaded
  useEffect(() => {
    // Cleanup previous rendition before rendering a new book
    let isMounted = true;
    if (rendition) {
      try {
        rendition.destroy && rendition.destroy();
      } catch {}
      setRendition(null);
    }
    if (book && mainAreaRef.current) {
      const area = mainAreaRef.current;
      // Defensive: Ensure mainAreaRef.current exists in DOM before calling renderTo
      if (!area.parentNode) return;

      const r = book.renderTo(area, {
        width: "100%",
        height: "100%",
        flow: "paginated",
        allowScriptedContent: false,
      });
      setRendition(r);

      // Apply theme and font size for readability
      r.themes.default({
        "body": {
          "background": "var(--bg-primary)",
          "color": "var(--text-primary)",
          "fontSize": `${fontSize * 100}%`,
          "lineHeight": "1.7",
        },
        "a": { color: "var(--reader-primary)" },
        "h1,h2,h3": { color: "var(--reader-secondary)" },
        "mark": { background: "var(--reader-accent)", color: "var(--text-primary)" }
      });

      r.themes.fontSize(`${fontSize * 100}%`);
      r.hooks.content.register(function(contents) {
        if (!contents.document.body) return;
        contents.document.body.style.background = "var(--bg-primary)";
        contents.document.body.style.color = "var(--text-primary)";

        // Inject keyboard listener into iframe, so arrow keys and spacebar work even when focus is inside the ebook iframe
        const keyHandler = (e) => {
          // Don't intercept while editing text/selecting (inputs etc) inside iframe
          const tag = contents.document.activeElement && contents.document.activeElement.tagName;
          if (tag === "INPUT" || tag === "TEXTAREA") return;
          if (
            e.code === "Space" ||
            e.key === " " ||
            e.key === "Spacebar" ||
            e.key === "ArrowRight"
          ) {
            e.preventDefault();
            window.requestAnimationFrame(() => {
              r.next();
            });
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            window.requestAnimationFrame(() => {
              r.prev();
            });
          }
        };
        // Remove any previous handler before adding
        contents.document.removeEventListener("keydown", keyHandler);
        contents.document.addEventListener("keydown", keyHandler, { capture: true });

        // Support for re-adding handler if iframe reloads content
        contents.window.addEventListener("focus", function () {
          contents.document.removeEventListener("keydown", keyHandler);
          contents.document.addEventListener("keydown", keyHandler, { capture: true });
        });
      });

      // Handle location change for navigation, bookmarks, analytics
      r.on("relocated", (location) => {
        if (!isMounted) return;
        setCurrentLoc(location.start.cfi);
        setCurrentChapter(
          (book.navigation && book.navigation.toc && book.navigation.toc.find((item) =>
            location.start.href && (item.href === location.start.href || item.href.endsWith("/" + location.start.href))
          ))?.label ?? ""
        );
      });

      // Go to previously bookmarked location if any
      const bookmarkForThisFile = bookmarks.find(b => b.fileName === fileName);
      if (bookmarkForThisFile && bookmarkForThisFile.cfi) {
        r.display(bookmarkForThisFile.cfi);
      } else {
        r.display();
      }
    }
    return () => {
      isMounted = false;
      if (rendition) {
        try {
          rendition.destroy && rendition.destroy();
        } catch {}
      }
    };
    // eslint-disable-next-line
  }, [book]);

  // Load TOC when book loads
  useEffect(() => {
    if (book) {
      book.loaded.navigation.then((nav) => {
        setToc(nav.toc);
      });
    } else {
      setToc([]);
    }
  }, [book]);

  // Autofocus mainArea on book load for keyboard navigation
  useEffect(() => {
    if (book && mainAreaRef.current) {
      mainAreaRef.current.focus();
    }
  }, [book]);

  // PUBLIC_INTERFACE
  function handleSetTheme(newTheme) {
    setTheme(newTheme);
  }

  // PUBLIC_INTERFACE
  function handleFileUpload(event) {
    const file = event.target.files[0];
    if (file && file.name.endsWith(".epub")) {
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = function(e) {
        const bookInstance = ePub(e.target.result, { openAs: "binary" });
        setBook(bookInstance);
        setSearchResults([]); // clear previous search state
        setSearchQuery("");
        // Reset UI state that could be stale
        setCurrentLoc("");
        setCurrentChapter("");
        // Optional: log upload event
        console.info("[UPLOAD] Loaded new EPUB:", file.name);
      };
      reader.readAsArrayBuffer(file);
    } else {
      alert("Please upload a valid .epub file.");
    }
  }

  // PUBLIC_INTERFACE
  function handleTocItemClick(href, cfi) {
    if (rendition) {
      if (cfi) {
        rendition.display(cfi);
      } else {
        rendition.display(href);
      }
      setShowToc(false);
    }
  }

  // PUBLIC_INTERFACE
  function handleFontAdjust(delta) {
    setFontSize(f => Math.min(2.5, Math.max(0.8, Number((f + delta).toFixed(2)))));
  }

  // PUBLIC_INTERFACE
  function handleToggleBookmark() {
    if (!currentLoc || !fileName) return;
    const bookmarkForThisBook = bookmarks.find(b => b.fileName === fileName);
    if (bookmarkForThisBook && bookmarkForThisBook.cfi === currentLoc) {
      setBookmarks(bookmarks.filter(b => !(b.fileName === fileName && b.cfi === currentLoc)));
    } else {
      setBookmarks([...bookmarks, { fileName, cfi: currentLoc, chapter: currentChapter || "", added: Date.now() }])
    }
  }

  // PUBLIC_INTERFACE
  function isBookmarked() {
    return bookmarks.some(b => b.fileName === fileName && b.cfi === currentLoc);
  }

  // PUBLIC_INTERFACE
  function handleGoToBookmark(b) {
    if (rendition && b.fileName === fileName) {
      rendition.display(b.cfi);
      setShowToc(false);
    }
  }

  // PUBLIC_INTERFACE
  /**
   * [BUGFIX/REWORK] Robust EPUB spine text extraction and indexing for search:
   * - Safely handles undefined or invalid `book` or `spineItems`
   * - Loads and indexes text from all parsable chapters, skips/reporting errors and continues for each spine section independently
   * - Aggregates success into Fuse.js search and displays both results and clear summary UI feedback to the user
   */
  async function handleSearch(query) {
    setSearchQuery(query);
    setSearchResults([]);

    // 1: If input is empty, forcibly clear results and exit
    if (!query || query.trim() === "") {
      setSearchResults([]);
      return;
    }

    // 2: Defensive—if no book loaded, display info message but do NOT allow phantom/stale/fake results
    if (!book || typeof book !== "object") {
      console.log("[SEARCH] Book is missing or query attempted with no book loaded");
      setSearchResults([
        { snippet: "[INFO] No ebook loaded. Please upload an EPUB file to search." }
      ]);
      return;
    }

    // 3: Ensure spineItems is a valid, present array
    let spineItems = [];
    try {
      if (book.spine && Array.isArray(book.spine.spineItems)) {
        spineItems = book.spine.spineItems;
      }
    } catch {}
    if (!spineItems.length) {
      console.warn("[SEARCH] No spine items loaded in book.");
      setSearchResults([{ snippet: "[INFO] No book content available (no chapters detected)." }]);
      return;
    }

    // 4: Build normalized query for matching
    const normalizedQuery = query.trim().toLowerCase();

    // 5: Extract chapter text, one chunk per spine
    let extractedChunks = [];
    let skippedSpineSections = [];
    let spineChunkMeta = [];
    let allSpineRaw = [];

    for (let i = 0; i < spineItems.length; ++i) {
      const spineItem = spineItems[i];
      let extractionError = null;
      let extracted = false;
      let chapterText = "";

      try {
        if (!spineItem || typeof spineItem.load !== "function") throw new Error("Spine item is missing or load() not callable");
        await spineItem.load(book && book.load ? book.load.bind(book) : undefined);

        let raw = "";
        try {
          if (spineItem.contents && typeof spineItem.contents.text === "function") {
            raw = await spineItem.contents.text();
            extracted = true;
          }
        } catch (innerErr) {
          if (
            spineItem.contents &&
            spineItem.contents.document &&
            spineItem.contents.document.documentElement
          ) {
            raw = spineItem.contents.document.documentElement.textContent || "";
            if (raw && raw.length > 0) {
              extracted = true;
            }
          } else {
            extractionError = innerErr;
          }
        }
        if (!extracted || !raw) throw new Error("Could not extract text");

        allSpineRaw.push((raw || "").slice(0, 220));
        chapterText = (typeof raw === "string" ? raw : "").replace(/<[^>]+>/g, " ");
        if (!chapterText || chapterText.trim().length === 0) {
          throw new Error("Extracted text is empty");
        }

        extractedChunks.push({
          text: chapterText,
          i,
          href: spineItem.href,
          cfi: spineItem.cfiBase,
          label: spineItem.idref
        });
        spineChunkMeta.push({ index: i, href: spineItem.href, len: chapterText.length });
      } catch (e) {
        skippedSpineSections.push({
          index: i,
          href: spineItem?.href,
          error: (e && e.message) || (extractionError && extractionError.message) || "Unknown error"
        });
        spineChunkMeta.push({ index: i, href: spineItem?.href, len: "ERROR" });
      } finally {
        try { await spineItem?.unload?.(); } catch {}
      }
    }

    // DEBUG: Show snapshot of what will actually be searched
    console.log("[SEARCH][DEBUG] At search time, extractedChunks.length =", extractedChunks.length);
    console.log("[SEARCH][DEBUG] extractedChunks (sample):", extractedChunks.slice(0, 2));
    if (extractedChunks.length === 0) console.warn("[SEARCH][DEBUG] No valid extracted text. Skipped/errored spineItems:", skippedSpineSections);

    // Dev/debug trigger—show chunks/skipped
    if (normalizedQuery.startsWith("!!debug")) {
      setSearchResults([
        {
          snippet:
            `[DEBUG] Total chapters: ${spineChunkMeta.length}, Extracted: ${extractedChunks.length}, Skipped: ${skippedSpineSections.length}\n` +
            `Chunk lens: ${JSON.stringify(spineChunkMeta)}\nSample: ` +
            (extractedChunks[0]?.text?.substring(0, 330) || "[N/A]")
        },
        ...(allSpineRaw.length > 0
          ? [{
              snippet:
                "[RAW] First raw spine chunk (HTML, may include markup):\n" +
                (allSpineRaw[0] || "[N/A]"),
            }]
          : []),
        ...(skippedSpineSections.length > 0
          ? [{
              snippet:
                `[DEBUG] Skipped ${skippedSpineSections.length} spine section(s):\n` +
                skippedSpineSections.map(
                  (s) => `  [${s.index}] ${s.href}: ${s.error || "Unknown"}`
                ).join("\n"),
            }]
          : []),
      ]);
      return;
    }

    // UI feedback summary, always display
    const infoSummary =
      `[INFO] Indexed ${extractedChunks.length}/${spineItems.length} chapters for search.` +
      (skippedSpineSections.length > 0
        ? ` Skipped ${skippedSpineSections.length} chapter${skippedSpineSections.length === 1 ? '' : 's'} due to extraction error.`
        : "");
    let feedbackItems = [{ snippet: infoSummary }];
    if (skippedSpineSections.length > 0) {
      feedbackItems.push({
        snippet:
          `[INFO] Some chapters could not be searched because of extraction error (${skippedSpineSections.length} skipped):\n` +
          skippedSpineSections
            .map(
              (s) =>
                `  [${s.index}] ${s.href || "[unknown]"}: ${s.error || "Unknown error"}`
            )
            .join("\n"),
      });
    }
    // 6: If we failed to extract ANY text (index = 0): NO results, NO placeholders, only info/warning
    if (extractedChunks.length === 0) {
      setSearchResults([
        ...feedbackItems,
        { snippet: "[SEARCH ERROR] Could not extract text from any book sections. Unable to search contents." }
      ]);
      return;
    }

    // 7: Build true search doc set. ONLY these are valid input for Fuse/manual search.
    const docs = extractedChunks.map((chunk) => ({
      index: chunk.i,
      text: chunk.text,
      href: chunk.href,
      cfi: chunk.cfi,
      label: chunk.label,
    }));

    // Log explicitly the full array of searchable text
    console.log("[SEARCH][DEBUG] Searchable text array for Fuse/manual search, length =", docs.length, docs);

    // 8: FUSE SEARCH. Run only if docs.length > 0 (should always be true at this point)
    let fuseResults = [], results = [];
    try {
      const fuse = new Fuse(docs, {
        keys: ["text"],
        includeMatches: true,
        minMatchCharLength: 3,
        threshold: 0.3,
        useExtendedSearch: true,
      });
      fuseResults = fuse.search(query || "");
      console.log("[SEARCH] FUSE found", fuseResults.length, "results. Sample:", fuseResults.slice(0, 3));
    } catch (fuseErr) {
      feedbackItems.push({ snippet: "[SEARCH ERROR] Fuse.js search failed: " + fuseErr.message });
      setSearchResults(feedbackItems);
      return;
    }

    for (const hit of fuseResults) {
      let snippet = "";
      if (hit.matches && hit.matches[0]?.indices?.[0]) {
        const [start, end] = hit.matches[0].indices[0];
        snippet = (hit.item.text || "").substring(Math.max(0, start - 30), Math.min(end + 40, hit.item.text.length));
      }
      results.push({
        i: hit.item.index,
        method: "fuse",
        href: hit.item.href,
        cfi: hit.item.cfi,
        snippet,
        title: hit.item.label
      });
    }

    // 9: Manual fallback searching (indexOf), still using ONLY extractedChunks
    let manualResults = [];
    for (let j = 0; j < extractedChunks.length; ++j) {
      const chunk = extractedChunks[j];
      if (!chunk.text || chunk.text.length === 0) continue;
      let txt = chunk.text;
      let idx = 0;
      let offset = 0;
      let occur = 0;
      let chunkHits = [];
      while (
        (idx = txt.toLowerCase().indexOf(normalizedQuery, offset)) !== -1
      ) {
        occur++;
        const snippet = txt.substring(
          Math.max(0, idx - 40),
          Math.min(txt.length, idx + normalizedQuery.length + 40)
        );
        chunkHits.push({
          href: chunk.href,
          cfi: chunk.cfi,
          snippet,
        });
        offset = idx + normalizedQuery.length;
      }
      if (occur > 0) {
        console.log(`[SEARCH][manual-indexOf] ${occur} hit(s) in chapter ${chunk.i} (${chunk.href})`);
        manualResults = manualResults.concat(
          chunkHits.map((h) => ({
            ...h,
            method: "indexOf",
            i: chunk.i,
          }))
        );
      }
    }

    // 10: Results/feedback for UI—never return fake/phantom results
    if (results.length === 0 && manualResults.length === 0) {
      setSearchResults([
        ...feedbackItems,
        { snippet: `[SEARCH] No results found for query '${normalizedQuery}'.` }
      ]);
    } else {
      setSearchResults([...feedbackItems, ...results, ...manualResults]);
    }
  }

  // PUBLIC_INTERFACE
  function handleGoToSearchResult(r) {
    if (rendition) {
      if (r.cfi) {
        rendition.display(r.cfi);
      } else if (r.href) {
        rendition.display(r.href);
      }
    }
  }

  // PUBLIC_INTERFACE
  function handleClearBook() {
    setBook(null);
    setRendition(null);
    setToc([]);
    setCurrentLoc("");
    setCurrentChapter("");
    setFileName("");
    setSearchResults([]);
    setSearchQuery("");
    // Defensive: log book clear
    console.info("[RESET] Cleared book and UI state.");
  }

  // Add document-level keyboard and click support for paging
  useEffect(() => {
    if (!book || !rendition) return;

    function handleDocKeyDown(e) {
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (
        e.code === "Space" ||
        e.key === " " ||
        e.key === "Spacebar" ||
        e.key === "ArrowRight"
      ) {
        e.preventDefault();
        rendition.next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        rendition.prev();
      }
    }

    function handleDocClick(e) {
      if (!mainAreaRef.current) return;
      const area = mainAreaRef.current;
      if (!area.contains(e.target)) return;

      const rect = area.getBoundingClientRect();
      const x = e.clientX;
      const y = e.clientY;

      if (
        x < rect.left ||
        x > rect.right ||
        y < rect.top ||
        y > rect.bottom
      )
        return;

      const relativeX = x - rect.left;
      const midpoint = rect.width / 2;
      const sidePadding = Math.max(24, 0.08 * rect.width);

      if (relativeX < midpoint - sidePadding) {
        rendition.prev();
      } else if (relativeX > midpoint + sidePadding) {
        rendition.next();
      }
      // Center region: do nothing
    }

    document.addEventListener("keydown", handleDocKeyDown);
    document.addEventListener("click", handleDocClick);

    // Cleanup
    return () => {
      document.removeEventListener("keydown", handleDocKeyDown);
      document.removeEventListener("click", handleDocClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, rendition, mainAreaRef.current]);

  // UI RENDER --------------------------
  return (
    <div className="ereader-root" data-theme={theme}>
      {/* Header */}
      <header className="ereader-header">
        <div className="header-left">
          <label className="upload-label" title="Upload EPUB">
            <FaUpload size={18} className="primary-color" />
            <input
              type="file"
              accept=".epub"
              onChange={handleFileUpload}
              style={{ display: "none" }}
              aria-label="Upload EPUB"
            />
          </label>
          <span className="app-title" onClick={handleClearBook}>
            eBook Reader
            {fileName && (
              <span className="file-name secondary-color">
                {" / "} {fileName}
              </span>
            )}
          </span>
        </div>

        <div className="header-controls">
          <div className="font-controls">
            <button
              className="icon-button"
              title="Decrease font"
              onClick={() => handleFontAdjust(-0.1)}
            >A-</button>
            <span className="font-size-span">{(fontSize * 100).toFixed(0)}%</span>
            <button
              className="icon-button"
              title="Increase font"
              onClick={() => handleFontAdjust(0.1)}
            >A+</button>
          </div>
          <button
            className="icon-button theme"
            title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            onClick={() => handleSetTheme(theme === "light" ? "dark" : "light")}
            aria-label="Switch theme"
            style={{ color: theme === "light" ? "#1e88e5" : "#ffc107" }}
          >
            {theme === "light" ? <FaMoon /> : <FaSun />}
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <div className="ereader-layout">
        {/* Sidebar TOC + Bookmarks */}
        <aside className={`ereader-sidebar ${showToc ? "" : "collapsed"}`}>
          {book ? (
            <>
              <div className="sidebar-section">
                <h2>Table of Contents</h2>
                <ul className="toc-list">
                  {toc.map(item => (
                    <li key={item.id || item.label}>
                      <button
                        className="toc-link"
                        onClick={() => handleTocItemClick(item.href, item.cfi)}
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="sidebar-section bookmarks">
                <h2>Bookmarks</h2>
                {bookmarks.filter(b => b.fileName === fileName).length > 0 ? (
                  <ul className="bookmarks-list">
                    {bookmarks
                      .filter(b => b.fileName === fileName)
                      .map(b => (
                        <li key={b.cfi + b.added}>
                          <button
                            className="bookmark-link"
                            onClick={() => handleGoToBookmark(b)}
                          >
                            <FaBookmark size={14} className="accent-color" />{" "}{b.chapter || "Bookmark"}
                          </button>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <span className="no-bookmarks">No bookmarks</span>
                )}
              </div>
            </>
          ) : (
            <div className="sidebar-placeholder">
              <h2 className="primary-color">Welcome!</h2>
              <p>Upload an EPUB to start reading.</p>
            </div>
          )}
        </aside>

        {/* Main Reading & Controls */}
        <main className="ereader-main">
          {book ? (
            <>
              <div className="main-toolbar">
                <button
                  className={`icon-button bookmark ${isBookmarked() ? "active" : ""}`}
                  title={isBookmarked() ? "Remove bookmark" : "Add bookmark"}
                  onClick={handleToggleBookmark}
                  aria-label="Toggle bookmark"
                >
                  {isBookmarked() ? <FaBookmark className="accent-color" /> : <FaRegBookmark />}
                </button>
                {/* Search bar */}
                <div className="search-controls">
                  <input
                    className="search-input"
                    type="search"
                    value={searchQuery}
                    placeholder="Search in book..."
                    onChange={e => handleSearch(e.target.value)}
                    aria-label="Search within book"
                  />
                  <FaSearch size={15} className="search-icon" />
                </div>
                <button
                  className="icon-button"
                  onClick={() => setShowToc((v) => !v)}
                  title={showToc ? "Hide sidebar" : "Show sidebar"}
                  aria-label="Toggle sidebar"
                >
                  ☰
                </button>
              </div>

              {/* Enhance the reading area to support mouse and keyboard navigation */}
              <div
                className="main-reader"
                ref={mainAreaRef}
                tabIndex={0}
                aria-label="Book reading area"
                style={{ outline: "none", position: "relative" }}
              >
                {/* Transparent overlay for mouse paging, full height/width of reading area */}
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    zIndex: 20,
                    pointerEvents: "auto",
                    background: "transparent",
                  }}
                  aria-hidden="true"
                  onClick={e => {
                    if (!mainAreaRef.current) return;
                    const area = mainAreaRef.current;
                    const rect = area.getBoundingClientRect();
                    const x = e.clientX;
                    const y = e.clientY;
                    if (
                      x < rect.left ||
                      x > rect.right ||
                      y < rect.top ||
                      y > rect.bottom
                    ) return;

                    const relativeX = x - rect.left;
                    const midpoint = rect.width / 2;
                    const sidePadding = Math.max(24, 0.08 * rect.width);

                    if (relativeX < midpoint - sidePadding) {
                      rendition && rendition.prev();
                    } else if (relativeX > midpoint + sidePadding) {
                      rendition && rendition.next();
                    }
                    // Clicking the center region does nothing
                  }}
                />
              </div>
              {/* Search results overlay */}
              {(searchQuery && searchResults.length > 0) && (
                <div className="search-results">
                  {/* Status/info/debug is always displayed as a summary at the top */}
                  {(searchResults[0]?.snippet?.startsWith("[DEBUG]") || searchResults[0]?.snippet?.startsWith("[INFO]") || searchResults[0]?.snippet?.startsWith("[SEARCH ERROR]")) && (
                    <pre style={{ fontSize: "0.89em", color: "#b57a00", background: "none", border: "none", margin: "0 0 7px 0", whiteSpace: "pre-wrap" }}>
                      {searchResults[0].snippet}
                    </pre>
                  )}
                  {!searchResults[0]?.snippet?.startsWith("[DEBUG]") && (
                    <>
                      <div className="search-results-title">
                        {searchResults.length} result{searchResults.length > 1 ? "s" : ""} for "<b>{searchQuery}</b>"
                      </div>
                      <ul className="search-results-list">
                        {searchResults.map((r, i) =>
                          r.snippet && (r.snippet.startsWith("[INFO]") || r.snippet.startsWith("[SEARCH ERROR]")) ? null : (
                            <li key={(r.cfi||"") + (r.href || "") + i}>
                              <button onClick={() => handleGoToSearchResult(r)}>
                                {/* Surface method for debug */}
                                {r.method && (
                                  <span style={{ fontSize: "0.8em", color: "#999", marginRight: 3 }}>
                                    [{r.method}]
                                  </span>
                                )}
                                ...{r.snippet?.replaceAll("\n", " ")}...
                              </button>
                            </li>
                          )
                        )}
                      </ul>
                    </>
                  )}
                </div>
              )}
              {(searchQuery && searchResults.length === 0) && (
                <div className="search-results-empty">No results for "<b>{searchQuery}</b>".</div>
              )}
            </>
          ) : (
            <div className="main-placeholder">
              <h1 className="primary-color">eBook Reader</h1>
              <p className="secondary-color">Welcome! Upload a local .epub file to get started.</p>
              <p className="modern-desc">Modern, minimalistic eBook reading with theme and font customization.<br />
                <span style={{marginTop:8, display:'inline-block'}}>Supports bookmarks, TOC, and in-book search.</span>
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;

