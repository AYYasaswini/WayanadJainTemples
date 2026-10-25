const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const script = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/i)?.[1];

assert.ok(script, "The website should contain its inline application script");

function createClassList() {
  const classes = new Set();

  return {
    add(name) {
      classes.add(name);
    },
    remove(name) {
      classes.delete(name);
    },
    toggle(name, force) {
      const shouldAdd = force === undefined ? !classes.has(name) : force;
      if (shouldAdd) classes.add(name);
      else classes.delete(name);
      return shouldAdd;
    },
    contains(name) {
      return classes.has(name);
    },
  };
}

function createElement({ dataset = {}, alt = "" } = {}) {
  const listeners = new Map();
  const attributes = new Map();

  return {
    dataset,
    alt,
    hidden: false,
    textContent: "",
    src: "",
    classList: createClassList(),
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    dispatch(type, event = {}) {
      const listener = listeners.get(type);
      assert.ok(listener, `Expected a ${type} listener`);
      listener(event);
    },
    querySelector(selector) {
      return this.children?.[selector] ?? null;
    },
    querySelectorAll(selector) {
      return this.descendants?.[selector] ?? [];
    },
  };
}

function createPage({ placeKinds = ["heritage", "living", "living"], galleryData } = {}) {
  const filterButtons = ["all", "heritage", "living"].map((filter) =>
    createElement({ dataset: { filter } }),
  );
  const placeCards = placeKinds.map((kind) =>
    createElement({ dataset: { kind } }),
  );
  const menuToggle = createElement();
  menuToggle.setAttribute("aria-expanded", "false");
  const navLinks = [createElement(), createElement()];
  const siteNav = createElement();
  siteNav.descendants = { a: navLinks };
  const galleryImage = createElement();
  const galleryCaption = createElement();
  const closeButton = createElement();
  const galleryDialog = createElement();
  galleryDialog.open = false;
  galleryDialog.children = {
    img: galleryImage,
    p: galleryCaption,
    ".gallery-close": closeButton,
  };
  galleryDialog.showModal = () => {
    galleryDialog.open = true;
  };
  galleryDialog.close = () => {
    galleryDialog.open = false;
  };
  const galleryItems = (galleryData ?? [
    { image: "/forest.jpg", caption: "Forest view", alt: "Green forest" },
  ]).map(({ image, caption, alt }) => {
    const item = createElement({ dataset: { image, caption } });
    item.children = { img: createElement({ alt }) };
    return item;
  });
  const resultsCount = createElement();

  const selectors = new Map([
    [".filter-button", filterButtons],
    [".place-card", placeCards],
    [".results-count", resultsCount],
    [".menu-toggle", menuToggle],
    [".site-nav", siteNav],
    [".gallery-dialog", galleryDialog],
    [".gallery-item", galleryItems],
  ]);

  const document = {
    querySelector(selector) {
      const value = selectors.get(selector);
      return Array.isArray(value) ? value[0] ?? null : value ?? null;
    },
    querySelectorAll(selector) {
      const value = selectors.get(selector);
      return Array.isArray(value) ? value : [];
    },
  };

  vm.runInNewContext(script, { document });

  return {
    filterButtons,
    placeCards,
    resultsCount,
    menuToggle,
    siteNav,
    navLinks,
    galleryDialog,
    galleryImage,
    galleryCaption,
    galleryItems,
    closeButton,
  };
}

test("page includes the five guide sections and matching navigation links", () => {
  for (const id of ["video", "overview", "places", "maps", "gallery"]) {
    assert.match(html, new RegExp(`id="${id}"`), `Missing #${id} section`);
    assert.match(html, new RegExp(`href="#${id}"`), `Missing navigation link to #${id}`);
  }
});

test("document has valid page metadata and one primary heading", () => {
  assert.match(html, /<!doctype html>/i, "Document should declare HTML5");
  assert.match(html, /<html\b[^>]*\blang="en"/i, "Document language should be declared");
  assert.match(html, /<meta\b[^>]*name="viewport"[^>]*content="[^"]+"/i);
  assert.match(html, /<title>\s*[^<]+\s*<\/title>/i, "Document title should not be empty");
  assert.equal([...html.matchAll(/<h1\b/gi)].length, 1, "Page should have exactly one h1");
  assert.match(html, /<main\b/i, "Page content should have a main landmark");
  assert.match(html, /<footer\b/i, "Page should have a footer landmark");
});

test("informational images and embedded map have accessible text alternatives", () => {
  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map(([image]) => image);
  assert.ok(images.length > 0, "Expected the page to contain images");
  for (const image of images) {
    assert.match(image, /\balt="[^"]*"/i, `Image needs an alt attribute: ${image}`);
  }

  assert.match(html, /<iframe\b[^>]*\btitle="[^"]+"/i, "Map iframe needs a title");
  assert.match(html, /<nav\b[^>]*aria-label="[^"]+"/i, "Navigation needs an accessible name");
  assert.match(html, /aria-live="polite"/i, "Filter result changes should be announced");
  assert.match(html, /aria-pressed="true"/i, "Selected filters should expose their state");
  assert.match(html, /<dialog\b[^>]*aria-label="[^"]+"/i, "Gallery dialog needs an accessible name");
  assert.match(html, /<iframe\b[^>]*\bloading="lazy"/i, "Map iframe should defer loading");
});

test("inline application script parses without syntax errors", () => {
  assert.doesNotThrow(() => new vm.Script(script));
});

test("responsive and reduced-motion styles are provided", () => {
  assert.match(html, /@media\s*\(max-width:\s*720px\)/i, "Mobile layout breakpoint is missing");
  assert.match(html, /@media\s*\(prefers-reduced-motion:\s*reduce\)/i, "Reduced-motion styles are missing");
  assert.match(html, /scroll-behavior:\s*auto\s*!important/i, "Reduced-motion scrolling should be disabled");
});

test("initial place filter state and result count agree with the number of featured places", () => {
  const placeCards = [...html.matchAll(/<article\b[^>]*class="place-card[^"]*"/gi)];
  const activeButtons = [...html.matchAll(/<button\b[^>]*class="[^"]*\bactive\b[^"]*"[^>]*aria-pressed="true"/gi)];

  assert.equal(placeCards.length, 3, "Expected three featured place cards");
  assert.equal(activeButtons.length, 1, "Exactly one filter should be selected initially");
  assert.match(html, /<span class="results-count"[^>]*>Showing 3 places<\/span>/);
});

test("page IDs are unique and every in-page link has a destination", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "The page should not contain duplicate IDs");

  const idSet = new Set(ids);
  const fragmentLinks = [...html.matchAll(/\bhref="#([^"]+)"/g)].map((match) => match[1]);
  for (const fragment of fragmentLinks) {
    assert.ok(idSet.has(fragment), `In-page link #${fragment} has no matching element`);
  }
});

test("links opening new tabs include safe rel attributes", () => {
  const externalAnchors = [...html.matchAll(/<a\b[^>]*href="https?:\/\/[^"]*"[^>]*>/gi)];

  assert.ok(externalAnchors.length > 0, "Expected external links to validate");
  for (const [anchor] of externalAnchors) {
    if (/\btarget="_blank"/i.test(anchor)) {
      assert.match(anchor, /\brel="[^"]*\bnoreferrer\b[^"]*"/i, anchor);
    }
  }
});

test("all buttons declare a non-submitting button type", () => {
  const buttons = [...html.matchAll(/<button\b[^>]*>/gi)].map(([button]) => button);

  assert.ok(buttons.length > 0, "Expected interactive buttons");
  for (const button of buttons) {
    assert.match(button, /\btype="button"/i, `Button should declare type=button: ${button}`);
  }
});

test("directory includes all submitted temple listings", () => {
  const listings = [
    ["Shri Adinath Swamy Digambar Jain Temple", "https://share.google/BieAI7N38K2yXAI0d"],
    ["Shri Adinatha Swami Jain Temple", "https://share.google/IMw4MYwldtFB51tcm"],
    ["Shri Parwanatha Swami Jain Temple", "https://share.google/lk3yCQB9AM1OPJVZz"],
    ["Chandranatha Swami Digambar Jain Temple", "https://share.google/ptToZs0yXcFmhgQEz"],
    ["Anjukunnu Jain Temple", "https://share.google/jJB4cOKnhhMSHeQA8"],
    ["Shanthinatha Swamy Jain Temple", "https://share.google/6ib6XNhMSOumGH3kp"],
    ["Varadoor Shri Ananthanatha Swami Temple", "https://share.google/bLxopVBkXBlAwsRKa"],
    ["Ananthanatha Swami Temple", "https://share.google/IvjqHIuq3atqkk13a"],
  ];
  for (const [name, url] of listings) {
    const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const linkedListing = html.match(
      new RegExp(`<a\\b[^>]*href="${escapedUrl}"[^>]*>[\\s\\S]*?<\\/a>`, "i"),
    );
    assert.ok(linkedListing, `Missing linked listing: ${name}`);
    assert.ok(linkedListing[0].includes(name), `Map link is not attached to ${name}`);
  }
});

test("place filters update card visibility, active state, and result count", () => {
  const page = createPage();
  const [all, heritage, living] = page.filterButtons;

  heritage.dispatch("click");
  assert.deepEqual(page.placeCards.map((card) => card.hidden), [false, true, true]);
  assert.equal(page.resultsCount.textContent, "Showing 1 place");
  assert.equal(heritage.getAttribute("aria-pressed"), "true");
  assert.equal(all.getAttribute("aria-pressed"), "false");

  living.dispatch("click");
  assert.deepEqual(page.placeCards.map((card) => card.hidden), [true, false, false]);
  assert.equal(page.resultsCount.textContent, "Showing 2 places");

  all.dispatch("click");
  assert.deepEqual(page.placeCards.map((card) => card.hidden), [false, false, false]);
  assert.equal(page.resultsCount.textContent, "Showing 3 places");
});

test("place filter reports zero results for a category with no matching cards", () => {
  const page = createPage({ placeKinds: ["heritage"] });
  const livingFilter = page.filterButtons.find((button) => button.dataset.filter === "living");

  livingFilter.dispatch("click");
  assert.deepEqual(page.placeCards.map((card) => card.hidden), [true]);
  assert.equal(page.resultsCount.textContent, "Showing 0 places");
  assert.equal(livingFilter.getAttribute("aria-pressed"), "true");
});

test("place filter handles an empty location list", () => {
  const page = createPage({ placeKinds: [] });
  const livingFilter = page.filterButtons.find((button) => button.dataset.filter === "living");

  livingFilter.dispatch("click");
  assert.deepEqual(page.placeCards.map((card) => card.hidden), []);
  assert.equal(page.resultsCount.textContent, "Showing 0 places");
});

test("mobile navigation opens and closes from menu and link actions", () => {
  const page = createPage();

  page.menuToggle.dispatch("click");
  assert.equal(page.menuToggle.getAttribute("aria-expanded"), "true");
  assert.equal(page.menuToggle.getAttribute("aria-label"), "Close navigation");
  assert.equal(page.siteNav.classList.contains("open"), true);

  page.navLinks[0].dispatch("click");
  assert.equal(page.menuToggle.getAttribute("aria-expanded"), "false");
  assert.equal(page.menuToggle.getAttribute("aria-label"), "Open navigation");
  assert.equal(page.siteNav.classList.contains("open"), false);
});

test("mobile navigation toggle can be opened and closed repeatedly", () => {
  const page = createPage();

  page.menuToggle.dispatch("click");
  page.menuToggle.dispatch("click");
  assert.equal(page.menuToggle.getAttribute("aria-expanded"), "false");
  assert.equal(page.menuToggle.getAttribute("aria-label"), "Open navigation");
  assert.equal(page.siteNav.classList.contains("open"), false);

  page.menuToggle.dispatch("click");
  page.navLinks[1].dispatch("click");
  assert.equal(page.menuToggle.getAttribute("aria-expanded"), "false");
  assert.equal(page.siteNav.classList.contains("open"), false);
});

test("gallery opens the selected image and closes from the button or backdrop", () => {
  const page = createPage();

  page.galleryItems[0].dispatch("click");
  assert.equal(page.galleryDialog.open, true);
  assert.equal(page.galleryImage.src, "/forest.jpg");
  assert.equal(page.galleryImage.alt, "Green forest");
  assert.equal(page.galleryCaption.textContent, "Forest view");

  page.closeButton.dispatch("click");
  assert.equal(page.galleryDialog.open, false);

  page.galleryItems[0].dispatch("click");
  page.galleryDialog.dispatch("click", { target: page.galleryDialog });
  assert.equal(page.galleryDialog.open, false);
});

test("gallery updates content when another image is selected", () => {
  const page = createPage({
    galleryData: [
      { image: "/forest.jpg", caption: "Forest view", alt: "Green forest" },
      { image: "/temple.jpg", caption: "Temple detail", alt: "Carved temple stone" },
    ],
  });

  page.galleryItems[1].dispatch("click");
  assert.equal(page.galleryDialog.open, true);
  assert.equal(page.galleryImage.src, "/temple.jpg");
  assert.equal(page.galleryImage.alt, "Carved temple stone");
  assert.equal(page.galleryCaption.textContent, "Temple detail");

  page.galleryDialog.dispatch("click", { target: page.galleryImage });
  assert.equal(page.galleryDialog.open, true, "Clicking image content should not dismiss the dialog");

  page.galleryDialog.dispatch("click", { target: page.galleryDialog });
  assert.equal(page.galleryDialog.open, false, "Clicking the backdrop should dismiss the dialog");
});
