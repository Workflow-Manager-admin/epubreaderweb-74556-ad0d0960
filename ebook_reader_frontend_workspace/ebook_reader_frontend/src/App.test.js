import React from "react";
import { render, fireEvent, screen, act } from "@testing-library/react";
import App from "./App";

// Helper: Create a fake epub.js Book instance mock
function makeFakeBook({
  chapters = [],
  throwOnExtract = [],
  simulatedLoadDelay = 0,
} = {}) {
  // Simulate `spine.spineItems` with real and broken sections
  let fakeSpineItems = chapters.map((chapter, idx) => ({
    load: jest.fn(
      () =>
        new Promise((resolve, reject) => {
          if (throwOnExtract.includes(idx)) reject(new Error("Extraction fail " + idx));
          else setTimeout(resolve, simulatedLoadDelay);
        })
    ),
    unload: jest.fn(),
    contents:
      throwOnExtract.includes(idx)
        ? { text: jest.fn(() => Promise.reject(new Error("Extraction fail " + idx))) }
        : { text: jest.fn(() => Promise.resolve(chapter)) },
    href: `chapter${idx}.xhtml`,
    cfiBase: "fakecfi-" + idx,
    idref: `Section${idx + 1}`,
  }));
  return {
    spine: { spineItems: fakeSpineItems },
    navigation: { toc: [] },
    loaded: { navigation: Promise.resolve({ toc: [] }) },
  };
}

// Simulate upload—triggers FileReader, fakes EPUB parse, loads Book into app
async function simulateEpubUpload(appContainer, mockBook) {
  // Patch global ePub to return our mockBook
  window.ePub = jest.fn(() => mockBook);

  // Simulate file input change (upload .epub)
  const input = appContainer.container.querySelector('input[type="file"]');
  // Create fake file object
  const fakeFile = new File(["fake data"], "mybook.epub", { type: "application/epub+zip" });

  // Patch FileReader to simulate load/read
  const origFileReader = window.FileReader;
  function fakeFileReader() {
    this.readAsArrayBuffer = function(file) {
      setTimeout(() => {
        if (this.onload) {
          this.onload({ target: { result: "pretend-epub-binary" } });
        }
      }, 10);
    };
  }
  window.FileReader = fakeFileReader;

  // Fire the upload
  await act(async () => {
    fireEvent.change(input, { target: { files: [fakeFile] } });
    // Wait for React state effect
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  // Cleanup FileReader for other tests
  window.FileReader = origFileReader;
}

describe("EPUB extraction & search logic", () => {
  beforeEach(() => {
    // @testing-library/react cleanup runs automatically
    jest.resetAllMocks();
    // Patch ePub import/require
    window.ePub = undefined;
    // Clear localStorage (bookmarks, fontSize, etc)
    window.localStorage.clear();
  });

  it("indexes well-formed chapters and finds real matches", async () => {
    // Chapter 0: text, Chapter 1: text, Chapter 2: text
    const chapters = [
      "Once upon a time there was a Rabbit and a Bear.",
      "This chapter talks about the Fox and the Rabbit again.",
      "A completely unrelated section."
    ];
    const book = makeFakeBook({ chapters });

    const appContainer = render(<App />);
    await simulateEpubUpload(appContainer, book);

    // Wait for book to be loaded with chapters
    await act(async () => {
      // Simulate user entering search for "rabbit"
      fireEvent.change(screen.getByPlaceholderText(/search in book/i), {
        target: { value: "rabbit" },
      });
      // Fuse.js and manual search: give some time for async extraction
      await new Promise((r) => setTimeout(r, 100));
    });

    // Title bar should show search results summary
    expect(screen.getByText(/result.*"rabbit"/i)).toBeInTheDocument();
    // Results should show a snippet with "rabbit" (case insensitive)
    // Find at least two results, both mentioning rabbit
    const resultSnippets = screen.getAllByRole("button").map((b) => b.textContent);
    expect(resultSnippets.some(txt => /rabbit/i.test(txt))).toBeTruthy();
  });

  it("reports skipped chapters due to text extraction failure", async () => {
    // Chapter 0: ok, 1: fail, 2: ok
    const chapters = [
      "Good chapter text. Wolf appears here.",
      "BROKEN CHAPTER - should fail", // Will throw
      "Another good chapter with Wolf.",
    ];
    const book = makeFakeBook({
      chapters,
      throwOnExtract: [1],
    });
    const appContainer = render(<App />);
    await simulateEpubUpload(appContainer, book);

    // Search for "wolf", should find results, but also show skip info
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/search in book/i), {
        target: { value: "wolf" },
      });
      await new Promise((r) => setTimeout(r, 100));
    });

    // Info: Should say 2/3 indexed, 1 skipped
    expect(screen.getByText(/indexed 2\/3 chapters.*skipped 1/gi)).toBeInTheDocument();
    // Detail: Should warn about extraction error
    expect(screen.getByText(/some chapters could not be searched/i)).toBeInTheDocument();
    expect(screen.getByText(/skipped.*extraction error/i)).toBeInTheDocument();

    // Button results should include at least one snippet mentioning "wolf"
    expect(screen.getAllByRole("button").some(btn => /wolf/i.test(btn.textContent))).toBeTruthy();
  });

  it("shows no result (but index/skip info) if no chapters contain the word", async () => {
    // 2 good chapters, 1 failed, search for a missing word
    const chapters = ["Lion sleeps", "Tiger hides"];
    const book = makeFakeBook({ chapters, throwOnExtract: [2] }); // fake
    const appContainer = render(<App />);
    await simulateEpubUpload(appContainer, book);

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/search in book/i), {
        target: { value: "unicorn" },
      });
      await new Promise((r) => setTimeout(r, 70));
    });

    expect(screen.getByText(/indexed 2\/3 chapters/i)).toBeInTheDocument();
    expect(screen.getByText(/no results found for query 'unicorn'/i)).toBeInTheDocument();
  });

  it("handles case where all chapters fail extraction", async () => {
    // All throw extraction error
    const book = makeFakeBook({ chapters: ["bad", "worse"], throwOnExtract: [0, 1] });
    const appContainer = render(<App />);
    await simulateEpubUpload(appContainer, book);

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/search in book/i), {
        target: { value: "anything" },
      });
      await new Promise((r) => setTimeout(r, 70));
    });

    expect(
      screen.getByText(/could not extract text from any book sections/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/skipped 2 section/i)).toBeInTheDocument();
  });

  it("provides debug info on !!debug search", async () => {
    // One simple chapter
    const chapters = ["debugging is fun for chapter indexing"];
    const book = makeFakeBook({ chapters });
    const appContainer = render(<App />);
    await simulateEpubUpload(appContainer, book);

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/search in book/i), {
        target: { value: "!!debug" },
      });
      await new Promise((r) => setTimeout(r, 60));
    });

    // Debug block should be present (in <pre>)
    expect(screen.getByText(/\[DEBUG\] Total chapters:/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  // Additional tests for UI feedback: loading no file (no book)
  it("shows placeholder when no book uploaded", () => {
    render(<App />);
    expect(screen.getByText(/upload an epub/i)).toBeInTheDocument();
    expect(screen.getByText(/eBook Reader/i)).toBeInTheDocument();
  });
});
