// @vitest-environment happy-dom

import { beforeEach, describe, expect, test } from "vitest";

import { normalizeReaderText } from "../../shared/reader-text";
import { READER_TEXT_VERSION } from "../../shared/types";
import {
  getCanonicalReaderText,
  resolveReaderTextLocation,
  resolveReaderTextRange,
  serializeReaderTextLocation,
  serializeReaderTextRange,
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
});
