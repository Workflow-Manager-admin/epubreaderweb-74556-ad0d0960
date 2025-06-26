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
    if (!book || !query) return;
    const results = [];
    // We use spine items instead of chapters for more reliable searching
    for (let i = 0; i < book.spine.spineItems.length; ++i) {
      const spineItem = book.spine.spineItems[i];
      try {
        const text = await spineItem.load(book.load.bind(book)).then(res => spineItem.contents.text()).then(text => {
          spineItem.unload();
          return text;
        });
        if (text && text.toLowerCase().includes(query.toLowerCase())) {
          // Simple snippet context
          const matchIdx = text.toLowerCase().indexOf(query.toLowerCase());
          const context = text.substring(Math.max(0, matchIdx - 40), matchIdx + query.length + 40);
          results.push({
            i,
            href: spineItem.href,
            cfi: spineItem.cfiBase, // We'll best effort display to href instead of cfi for simplicity
            snippet: context,
          });
        }
      } catch { /* Skip errors */ }
    }
    setSearchResults(results);
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
      // Don't interfere with typing in inputs/textareas/search box
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
      // Restrict click-to-page to the main reading area only, not in overlays
      if (!mainAreaRef.current) return;
      const area = mainAreaRef.current;
      if (!area.contains(e.target)) return;

      const rect = area.getBoundingClientRect();
      const x = e.clientX;
      const y = e.clientY;
      // Only consider clicks within the main reading box
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
                style={{ outline: "none" }}
              />
              {/* Search results overlay */}
              {(searchQuery && searchResults.length > 0) && (
                <div className="search-results">
                  <div className="search-results-title">
                    {searchResults.length} result{searchResults.length > 1 ? "s" : ""} for "<b>{searchQuery}</b>"
                  </div>
                  <ul className="search-results-list">
                    {searchResults.map((r, i) => (
                      <li key={r.cfi + i}>
                        <button onClick={() => handleGoToSearchResult(r)}>
                          ...{r.snippet?.replaceAll("\n", " ")}...
                        </button>
                      </li>
                    ))}
                  </ul>
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

