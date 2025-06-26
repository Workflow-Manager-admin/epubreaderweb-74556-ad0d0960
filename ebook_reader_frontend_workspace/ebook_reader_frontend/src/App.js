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
        setSearchResults([]);
        setSearchQuery("");
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
  async function handleSearch(query) {
    setSearchQuery(query);
    setSearchResults([]);
    if (!book || !query) {
      console.log("[SEARCH] Book is missing or query is empty");
      return;
    }
    const results = [];
    const normalizedQuery = query.trim().toLowerCase();

    // Step 1: Robust and error-tolerant text extraction from spine items
    if (!book.spine || !book.spine.spineItems || book.spine.spineItems.length === 0) {
      console.warn("[SEARCH] No spine items loaded in book.");
      setSearchResults([{ snippet: "[DEBUG] No book spine items loaded." }]);
      return;
    }
    console.log(`[SEARCH] Book has ${book.spine.spineItems.length} spine items. Extracting all text for query='${normalizedQuery}'`);

    let allSpineText = "";
    let spineChunkMeta = [];
    let allSpineRaw = [];
    const skippedSpineSections = [];
    const validSpineIndexes = [];

    for (let i = 0; i < book.spine.spineItems.length; ++i) {
      const spineItem = book.spine.spineItems[i];
      let text = "";
      let extracted = false;
      try {
        if (!spineItem || typeof spineItem.load !== "function") {
          // Defensive: skip
          console.error(`[SEARCH] [${i}] Spine item is undefined or invalid`);
          skippedSpineSections.push({ index: i, href: spineItem?.href, error: "Spine item missing/invalid" });
          spineChunkMeta.push({ index: i, href: spineItem?.href, len: "ERROR" });
          continue;
        }
        await spineItem.load(book.load ? book.load.bind(book) : undefined);
        let raw = "";

        try {
          // Try epubjs `text()` method
          if (spineItem.contents && typeof spineItem.contents.text === "function") {
            raw = await spineItem.contents.text();
            extracted = true;
            console.log(`[SEARCH] [${i}] .contents.text() (len=${raw?.length}): '${(raw || "").slice(0, 100)}...'`);
          }
        } catch (innerErr) {
          // Try .documentElement fallback
          console.warn(`[SEARCH] [${i}] .contents.text() failed, error:`, innerErr);
          if (
            spineItem.contents &&
            spineItem.contents.document &&
            spineItem.contents.document.documentElement
          ) {
            raw = spineItem.contents.document.documentElement.textContent || "";
            if (raw && raw.length > 0) {
              extracted = true;
              console.warn(`[SEARCH] [${i}] .documentElement.textContent fallback (len=${raw.length})`);
            }
          }
        }

        if (!extracted) {
          // Final fallback—try using the raw spineItem properties if possible
          if (spineItem?.href) {
            console.warn(`[SEARCH] [${i}] Unable to extract text for spine '${spineItem.href}', skipping this section.`);
            skippedSpineSections.push({ index: i, href: spineItem.href, error: "Could not extract text" });
            spineChunkMeta.push({ index: i, href: spineItem.href, len: "ERROR" });
            try { await spineItem.unload(); } catch {}
            continue;
          }
        }

        allSpineRaw.push((raw || "").slice(0, 220));
        text = (typeof raw === "string" ? raw : "").replace(/<[^>]+>/g, " ");

        if (!text || text.trim().length === 0) {
          console.warn(`[SEARCH] [${i}] Cleaned text is empty (${spineItem.href})`);
        } else {
          validSpineIndexes.push(i);
          console.log(`[SEARCH] [${i}] Cleaned (len=${text.length}): '${text.substring(0, 60).replace(/\s+/g, " ")}...'`);
        }
        allSpineText += (text || "") + "\n";
        spineChunkMeta.push({ index: i, href: spineItem.href, len: text.length });
        try { await spineItem.unload(); } catch {}
      } catch (e) {
        try { spineItem && spineItem.unload && spineItem.unload(); } catch {}
        skippedSpineSections.push({ index: i, href: spineItem?.href, error: e?.message || "Unknown error" });
        spineChunkMeta.push({ index: i, href: spineItem?.href, len: "ERROR" });
        console.error(`[SEARCH] [${i}] Error processing '${spineItem?.href}':`, e);
      }
    }
    console.log(`[SEARCH] [SUM] All chapter text extracted, allSpineText length: ${allSpineText.length}`, spineChunkMeta);

    // Surface debug info in the UI if search is in debug mode
    if (normalizedQuery === "!!debug" || normalizedQuery.startsWith("!!debug")) {
      setSearchResults([
        {
          snippet:
            "[DEBUG] " +
            `Total chapters: ${spineChunkMeta.length}, All text length: ${allSpineText.length}\n` +
            "Chunk lens: " +
            JSON.stringify(spineChunkMeta) +
            "\nSample: " +
            (allSpineText.substring(0, 330) || "[N/A]"),
        },
        {
          snippet:
            "[RAW] First raw spine chunk (HTML, may include markup):\n" +
            (allSpineRaw[0] || "[N/A]"),
        },
        ...(skippedSpineSections.length > 0
          ? [
              {
                snippet:
                  `[DEBUG] Skipped ${skippedSpineSections.length} spine section(s):\n` +
                  skippedSpineSections.map(
                    (s) => `  [${s.index}] ${s.href}: ${s.error || "Unknown"}`
                  ).join("\n"),
              },
            ]
          : []),
      ]);
      return;
    }

    // Step 2: Build error-tolerant Fuse search input
    const spineChunksArr = [];
    let chunkMapping = [];
    for (let i = 0; i < book.spine.spineItems.length; ++i) {
      let chunk = "";
      let extracted = false;
      try {
        const si = book.spine.spineItems[i];
        if (!si || typeof si.load !== "function") {
          chunk = "";
        } else {
          await si.load(book.load ? book.load.bind(book) : undefined);
          let raw = "";
          try {
            if (si.contents && typeof si.contents.text === "function") {
              raw = await si.contents.text();
              extracted = true;
            }
          } catch {
            if (
              si.contents &&
              si.contents.document &&
              si.contents.document.documentElement
            ) {
              raw = si.contents.document.documentElement.textContent || "";
              if (raw && raw.length > 0) extracted = true;
            }
          }
          chunk = (typeof raw === "string" ? raw : "").replace(/<[^>]+>/g, " ");
          await si.unload();
          if (!extracted) {
            chunk = "";
          }
        }
      } catch {
        chunk = "";
      }
      spineChunksArr.push(chunk);
      chunkMapping.push({
        index: i,
        href: book.spine.spineItems[i]?.href,
        base: book.spine.spineItems[i]?.cfiBase,
        strLen: chunk.length,
        skipped: skippedSpineSections.some((s) => s.index === i),
      });
    }
    if (skippedSpineSections.length > 0) {
      console.info(
        `[SEARCH] Skipped extracting text from ${skippedSpineSections.length} spines: `,
        skippedSpineSections
      );
    }
    console.log("[SEARCH] FUSE data structure:", chunkMapping);

    let fuseResults = [];
    if (spineChunksArr.filter(Boolean).length === 0) {
      setSearchResults([
        {
          snippet: `[SEARCH ERROR] Could not extract text from any book sections. Unable to search contents.`,
        },
        ...(skippedSpineSections.length > 0
          ? [
              {
                snippet:
                  `[INFO] Skipped ${skippedSpineSections.length} section(s) due to extraction errors:\n` +
                  skippedSpineSections
                    .map(
                      (s) =>
                        `  [${s.index}] ${s.href || "[unknown]"}: ${
                          s.error || "Unknown error"
                        }`
                    )
                    .join("\n"),
              },
            ]
          : []),
      ]);
      return;
    }

    // Step 3: FUSE.JS SEARCH (Word fuzz/index match)
    const docs = spineChunksArr.map((chunk, i) => ({
      index: i,
      text: chunk || "",
      href: book.spine.spineItems[i]?.href,
      cfi: book.spine.spineItems[i]?.cfiBase,
    }));

    const fuse = new Fuse(docs, {
      keys: ["text"],
      includeMatches: true,
      minMatchCharLength: 3,
      threshold: 0.3,
      useExtendedSearch: true,
    });
    fuseResults = fuse.search(query || "");
    console.log("[SEARCH] FUSE found", fuseResults.length, "results. Sample:", fuseResults.slice(0, 3));

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
      });
    }

    // Step 4: FALLBACK - DIRECT STRING SEARCH (indexOf, cross-check)
    let manualResults = [];
    for (let i = 0; i < spineChunksArr.length; ++i) {
      if (!spineChunksArr[i] || spineChunksArr[i].length === 0) continue;
      const txt = spineChunksArr[i];
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
          href: book.spine.spineItems[i]?.href,
          cfi: book.spine.spineItems[i]?.cfiBase,
          snippet,
        });
        offset = idx + normalizedQuery.length;
      }
      if (occur > 0) {
        console.log(
          `[SEARCH] [manual-indexOf] ${occur} hit(s) in chapter ${i} (${book.spine.spineItems[i]?.href})`
        );
        manualResults = manualResults.concat(
          chunkHits.map((h) => ({
            ...h,
            method: "indexOf",
            i,
          }))
        );
      }
    }

    // Compose user-facing feedback if some sections failed
    let feedbackItems = [];
    if (skippedSpineSections.length > 0) {
      feedbackItems.push({
        snippet:
          `[INFO] Some book sections could not be searched because of unsupported format/extraction error (${skippedSpineSections.length} section${skippedSpineSections.length === 1 ? '' : 's'} skipped):\n` +
          skippedSpineSections
            .map(
              (s) =>
                `  [${s.index}] ${s.href || "[unknown]"}: ${
                  s.error || "Unknown error"
                }`
            )
            .join("\n"),
      });
    }

    if (results.length === 0 && manualResults.length > 0) {
      setSearchResults([...feedbackItems, ...manualResults]);
    } else if (results.length > 0) {
      setSearchResults([...feedbackItems, ...results, ...manualResults]);
    } else {
      setSearchResults([
        ...feedbackItems,
        {
          snippet: `[SEARCH] No results at all for query '${normalizedQuery}'.`,
        },
      ]);
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
                  {/* DEBUG UI: Special info if results contain our debug marker */}
                  {searchResults[0]?.snippet && searchResults[0].snippet.startsWith("[DEBUG]") ? (
                    <pre style={{ fontSize: "0.87em", color: "#757" }}>{searchResults[0].snippet}</pre>
                  ) : (
                    <>
                      {searchResults[0]?.snippet?.startsWith("[INFO]") && (
                        <div style={{ color: "#b57a00", padding: "5px 0", fontSize: "0.98em" }}>
                          {searchResults[0].snippet}
                        </div>
                      )}
                      <div className="search-results-title">
                        {searchResults.length} result{searchResults.length > 1 ? "s" : ""} for "<b>{searchQuery}</b>"
                      </div>
                      <ul className="search-results-list">
                        {searchResults.map((r, i) =>
                          r.snippet && r.snippet.startsWith("[INFO]") ? null : (
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

