// @vitest-environment happy-dom

import { beforeEach, describe, expect, test } from "vitest";

import { createReaderTextLocation, normalizeReaderText } from "../../shared/reader-text";
import { READER_TEXT_VERSION } from "../../shared/types";
import {
  getCanonicalReaderText,
  hasReaderTextLocationOnPage,
  resolveReaderTextLocation,
  resolveReaderTextRange,
  serializeReaderTextLocation,
  serializeReaderTextRange,
  serializeReaderViewportLocation,
} from "./reader-location";

const SECTION_HREF = "OEBPS/chapter-1.xhtml";

const render = (markup: string) => {
  document.body.innerHTML = markup;
  const root = document.querySelector("article");
  if (!root) throw new Error("The test reader article is missing.");
  return root;
};

const textNode = (element: Element, index = 0) => {
  const nodes = Array.from(element.childNodes).filter((node): node is Text =>
    node instanceof Text,
  );
  const node = nodes[index];
  if (!node) throw new Error("The expected text node is missing.");
  return node;
};

beforeEach(() => {
  document.body.replaceChildren();
});

describe("reader text locations", () => {
  test("serializes and re-anchors a point after preceding text shifts", () => {
    const original = render("<article><p>Alpha <em>brave</em> new world.</p></article>");
    const paragraph = original.querySelector("p");
    if (!paragraph) throw new Error("The test paragraph is missing.");

    const boundary = document.createRange();
    boundary.setStart(textNode(paragraph), "Alpha ".length);
    boundary.collapse(true);
    const stored = serializeReaderTextLocation(SECTION_HREF, original, boundary);

    expect(stored).toEqual({
      sectionHref: SECTION_HREF,
      textVersion: READER_TEXT_VERSION,
      offset: 6,
      prefix: "Alpha ",
      suffix: "brave new world.",
    });

    const rerendered = render(
      "<article style='font-size: 24px; width: 300px'>Opening. Alpha <strong>brave</strong> new world.</article>",
    );
    const resolved = stored ? resolveReaderTextLocation(rerendered, stored) : null;

    expect(resolved?.collapsed).toBe(true);
    expect(resolved?.startContainer.textContent).toBe("brave");
    expect(resolved?.startOffset).toBe(0);
  });

  test("rejects a text point outside the reader", () => {
    const root = render("<article><p>Readable text</p></article><p id=outside>Outside</p>");
    const outside = textNode(document.querySelector("#outside") as Element);
    const boundary = document.createRange();
    boundary.setStart(outside, 2);
    boundary.collapse(true);

    expect(serializeReaderTextLocation(SECTION_HREF, root, boundary)).toBeNull();
  });

  test("serializes and resolves a selection spanning inline elements", () => {
    const root = render(
      '<article><p id="line">Alpha \n <em>brave</em>   new world.</p></article>',
    );
    const paragraph = root.querySelector("#line");
    if (!paragraph) throw new Error("The test paragraph is missing.");

    const first = textNode(paragraph);
    const last = textNode(paragraph, 1);
    const selection = document.createRange();
    selection.setStart(first, 0);
    selection.setEnd(last, "   new".length);

    const stored = serializeReaderTextRange(SECTION_HREF, root, selection);

    expect(stored).toEqual({
      sectionHref: SECTION_HREF,
      textVersion: READER_TEXT_VERSION,
      offset: 0,
      endOffset: 15,
      exact: "Alpha brave new",
      prefix: "",
      suffix: " world.",
    });

    root.setAttribute("style", "font-size: 24px; width: 320px; line-height: 2");
    const resolved = stored ? resolveReaderTextRange(root, stored) : null;
    expect(resolved).not.toBeNull();
    expect(normalizeReaderText(resolved?.toString() ?? "")).toBe("Alpha brave new");
  });

  test("survives reparsing and equivalent markup changes", () => {
    const original = render(
      '<article><p id="line">Alpha <em>brave</em> new world.</p></article>',
    );
    const paragraph = original.querySelector("#line");
    if (!paragraph) throw new Error("The test paragraph is missing.");

    const selection = document.createRange();
    selection.setStart(textNode(paragraph), 6);
    selection.setEnd(textNode(paragraph, 1), 4);
    const stored = serializeReaderTextRange(SECTION_HREF, original, selection);

    const rerendered = render(
      '<article><section><p>Alpha <span><em>brave</em></span>   new world.</p></section></article>',
    );
    const resolved = stored ? resolveReaderTextRange(rerendered, stored) : null;

    expect(normalizeReaderText(resolved?.toString() ?? "")).toBe("brave new");
  });

  test("uses quote context to re-anchor repeated text after preceding content shifts", () => {
    const root = render(
      "<article><p>Intro target phrase alpha. Later target phrase omega.</p></article>",
    );
    const node = textNode(root.querySelector("p") as Element);
    const secondMatch = node.data.lastIndexOf("target phrase");
    const selection = document.createRange();
    selection.setStart(node, secondMatch);
    selection.setEnd(node, secondMatch + "target phrase".length);
    const stored = serializeReaderTextRange(SECTION_HREF, root, selection);
    if (!stored) throw new Error("The test range was not serialized.");

    node.data = `A new opening. ${node.data}`;
    const resolved = resolveReaderTextRange(root, stored);

    expect(resolved?.toString()).toBe("target phrase");
    expect(resolved?.startOffset).toBe(node.data.lastIndexOf("target phrase"));
  });

  test("fails instead of jumping when the selected quote no longer exists", () => {
    const root = render("<article><p>This phrase will vanish.</p></article>");
    const node = textNode(root.querySelector("p") as Element);
    const selection = document.createRange();
    selection.setStart(node, 5);
    selection.setEnd(node, 11);
    const stored = serializeReaderTextRange(SECTION_HREF, root, selection);
    if (!stored) throw new Error("The test range was not serialized.");

    node.data = "This passage was replaced.";

    expect(resolveReaderTextRange(root, stored)).toBeNull();
  });

  test("rejects collapsed, whitespace-only, and out-of-reader selections", () => {
    const root = render("<article><p>Readable text</p><p>   </p></article><p id=outside>Outside</p>");
    const readable = textNode(root.querySelector("p") as Element);
    const whitespace = textNode(root.querySelectorAll("p")[1]);
    const outside = textNode(document.querySelector("#outside") as Element);

    const collapsed = document.createRange();
    collapsed.setStart(readable, 2);
    collapsed.collapse(true);

    const blank = document.createRange();
    blank.selectNodeContents(whitespace);

    const external = document.createRange();
    external.selectNodeContents(outside);

    expect(serializeReaderTextRange(SECTION_HREF, root, collapsed)).toBeNull();
    expect(serializeReaderTextRange(SECTION_HREF, root, blank)).toBeNull();
    expect(serializeReaderTextRange(SECTION_HREF, root, external)).toBeNull();
  });

  test("exposes the canonical text used for persisted offsets", () => {
    const root = render("<article>One\n\t<span>two</span>   three</article>");

    expect(getCanonicalReaderText(root)).toBe("One two three");
  });

  /**
   * A paginated page shows a contiguous run of characters, so the capture has to
   * report the first character of the visible column even when the run starts in
   * the middle of a text node. Geometry is modelled here because happy-dom does
   * not lay text out: characters 0-19 sit on the page that scrolled off to the
   * left, characters 20-39 fill the viewport, and the spaces at 19 and 29 are
   * collapsed to empty boxes the way line-breaking whitespace is.
   */
  test("captures the first character the paginated viewport shows", () => {
    const text = "Alpha beta gamma if epsilon a zeta etas. Next page words.";
    const root = render(`<article><p>${text}</p></article>`);
    const paragraph = root.querySelector("p") as Element;
    const node = textNode(paragraph);
    const viewport = document.createElement("div");
    const originalBoundingRect = Range.prototype.getBoundingClientRect;
    const originalClientRects = Range.prototype.getClientRects;
    const PAGE_WIDTH = 200;
    const CHARACTERS_PER_PAGE = 20;
    const CHARACTER_WIDTH = PAGE_WIDTH / CHARACTERS_PER_PAGE;
    const COLLAPSED_CHARACTERS: Record<number, true> = { 19: true, 29: true };
    // Browsers answer with an empty rect list for a character that line breaking
    // collapsed away, which surfaces as an all-zero bounding box.
    const EMPTY_RECT = { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0 } as DOMRect;
    const rect = (left: number, right: number) =>
      ({ bottom: 20, height: 20, left, right, top: 0, width: right - left }) as DOMRect;
    const characterRect = (index: number) => {
      if (COLLAPSED_CHARACTERS[index]) return EMPTY_RECT;
      const page = Math.floor(index / CHARACTERS_PER_PAGE);
      const left = (index % CHARACTERS_PER_PAGE) * CHARACTER_WIDTH + (page - 1) * PAGE_WIDTH;
      return rect(left, left + CHARACTER_WIDTH);
    };

    viewport.getBoundingClientRect = () => rect(0, PAGE_WIDTH);
    root.getBoundingClientRect = () => rect(-PAGE_WIDTH, PAGE_WIDTH * 2);
    Range.prototype.getBoundingClientRect = function boundingRect(this: Range) {
      return this.startContainer === node && this.endOffset - this.startOffset === 1
        ? characterRect(this.startOffset)
        : rect(-PAGE_WIDTH, PAGE_WIDTH);
    };
    Range.prototype.getClientRects = function clientRects(this: Range) {
      if (this.startContainer === node && this.endOffset - this.startOffset === 1) {
        const bounds = characterRect(this.startOffset);
        return (bounds.width > 0 || bounds.height > 0 ? [bounds] : []) as unknown as DOMRectList;
      }
      return [rect(-PAGE_WIDTH, 0), rect(0, PAGE_WIDTH)] as unknown as DOMRectList;
    };

    try {
      expect(serializeReaderViewportLocation(SECTION_HREF, root, viewport)).toEqual({
        sectionHref: SECTION_HREF,
        textVersion: READER_TEXT_VERSION,
        offset: 20,
        prefix: "Alpha beta gamma if ",
        suffix: "epsilon a zeta etas. Next page words.",
      });

      const previousPage = createReaderTextLocation(SECTION_HREF, text, 5);
      const visiblePage = createReaderTextLocation(SECTION_HREF, text, 20);
      const nextPage = createReaderTextLocation(SECTION_HREF, text, 40);
      if (!previousPage || !visiblePage || !nextPage) {
        throw new Error("The test locations were not created.");
      }

      expect(hasReaderTextLocationOnPage(root, PAGE_WIDTH, 2, [previousPage])).toBe(false);
      expect(hasReaderTextLocationOnPage(root, PAGE_WIDTH, 2, [visiblePage])).toBe(true);
      expect(hasReaderTextLocationOnPage(root, PAGE_WIDTH, 2, [nextPage])).toBe(false);
      expect(
        hasReaderTextLocationOnPage(root, PAGE_WIDTH, 2, [previousPage, visiblePage]),
      ).toBe(true);
    } finally {
      Range.prototype.getBoundingClientRect = originalBoundingRect;
      Range.prototype.getClientRects = originalClientRects;
    }
  });

  test("reports no location when the page shows no text", () => {
    const root = render("<article><img alt='Cover' src='cover.jpg'></article>");
    const viewport = document.createElement("div");

    expect(serializeReaderViewportLocation(SECTION_HREF, root, viewport)).toBeNull();
  });
});
