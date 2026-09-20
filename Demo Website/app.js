const courseList = document.querySelector("#course-list");
const emptyState = document.querySelector("#empty-state");
const dashboard = document.querySelector("#dashboard");
const loadError = document.querySelector("#load-error");
const courseOrder = ["CPSC103", "CPSC221", "CPSC213"];
const ratingMax = 5;
let courses = [];
let activeView = "compare";
let selectedCode = "";
let lastSignature = "";
let loading = false;

function el(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = String(value);
  return element;
}

function numberInRange(value, max) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const text = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 && number <= max ? number : null;
}

function formatScore(value) {
  return value === null ? "\u2014" : value.toFixed(1);
}

function normalizeCode(value) {
  return String(value || "").toUpperCase().replace(/\s+/g, "");
}

function displayCode(value) {
  return value.replace(/^(CPSC)(\d+)$/, "$1 $2");
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch { return null; }
}

function recordsToCourses(payload) {
  if (!payload || !Array.isArray(payload.records)) throw new Error("The backend response has no records array.");
  const grouped = new Map();
  for (const record of payload.records) {
    const code = normalizeCode(record?.data?.course_code);
    if (!courseOrder.includes(code)) continue;
    if (!grouped.has(code)) grouped.set(code, []);
    grouped.get(code).push(record);
  }
  return [...grouped].map(([code, matches]) => {
    matches.sort((a, b) => (Date.parse(b.extracted_at) || 0) - (Date.parse(a.extracted_at) || 0));
    const score = (field) => {
      const match = matches.find((record) => numberInRange(record.data?.[field], ratingMax) !== null);
      return match ? numberInRange(match.data[field], ratingMax) : null;
    };
    const reviewRecord = matches.find((record) => numberInRange(record.data?.number_of_reviews, 10000000) !== null);
    const sources = [...new Set(matches.flatMap((record) => [
      record.source_url,
      record.data?.source_url,
      ...(Array.isArray(record.source_urls) ? record.source_urls : []),
      ...Object.values(record.field_sources || {})
    ]).filter(Boolean))];
    return {
      code,
      easiness: score("easiness"),
      interest: score("interest"),
      usefulness: score("usefulness"),
      reviews: reviewRecord ? numberInRange(reviewRecord.data.number_of_reviews, 10000000) : null,
      sources
    };
  }).sort((a, b) => courseOrder.indexOf(a.code) - courseOrder.indexOf(b.code));
}

function average(values) {
  const present = values.filter((value) => value !== null);
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

function setRing(id, value, name) {
  const ring = document.querySelector("#" + id + "-pie");
  document.querySelector("#" + id + "-value").textContent = formatScore(value);
  const circumference = 2 * Math.PI * 82;
  document.querySelector("#" + id + "-arc").style.strokeDashoffset =
    String(circumference * (1 - (value === null ? 0 : value) / ratingMax));
  ring.setAttribute("aria-label", value === null ? name + " data unavailable" : name + " " + formatScore(value) + " out of " + ratingMax);
}

function renderSummary(payload) {
  document.querySelector("#total-courses").textContent = courses.length;
  document.querySelector("#sidebar-count").textContent = String(courses.length).padStart(2, "0");
  document.querySelector("#average-usefulness").textContent = formatScore(average(courses.map((course) => course.usefulness)));
  const reviewCounts = courses.map((course) => course.reviews).filter((value) => value !== null);
  document.querySelector("#total-reviews").textContent = reviewCounts.length ? reviewCounts.reduce((sum, count) => sum + count, 0).toLocaleString() : "\u2014";
  const live = courses.length > 0;
  document.querySelector("#connection-label").textContent = live ? "LIVE DATA" : "WAITING FOR DATA";
  document.querySelector(".connection-dot").classList.toggle("live", live);
  document.querySelector(".topbar-signal").classList.toggle("live", live);
  document.querySelector("#job-status").textContent = live ? (payload.status || "CONNECTED").toUpperCase() : "AWAITING DATA";
  renderView();
}

function renderView() {
  const live = courses.length > 0;
  emptyState.hidden = live;
  dashboard.hidden = !live || activeView !== "course";
  document.querySelector("#comparison").hidden = !live || activeView !== "compare";
  document.querySelector("#compare-tab").classList.toggle("active", activeView === "compare");
  document.querySelector("#course-tab").classList.toggle("active", activeView === "course");
  document.querySelector("#compare-tab").setAttribute("aria-pressed", String(activeView === "compare"));
  document.querySelector("#course-tab").setAttribute("aria-pressed", String(activeView === "course"));
}

function renderComparison() {
  const metrics = [
    { key: "easiness", label: "EASINESS", note: "Average course rating" },
    { key: "interest", label: "INTEREST", note: "Average course rating" },
    { key: "usefulness", label: "USEFULNESS", note: "Average course rating" },
    { key: "reviews", label: "NUMBER OF REVIEWS", note: "Student review volume" }
  ];
  const grid = document.querySelector("#comparison-grid");
  grid.replaceChildren();
  for (const metric of metrics) {
    const card = el("article", "comparison-card");
    const heading = el("div", "comparison-heading");
    const title = el("div");
    title.append(el("span", "section-label", metric.label), el("p", "", metric.note));
    heading.append(title, el("span", "comparison-index", String(metrics.indexOf(metric) + 1).padStart(2, "0") + " / 04"));
    card.append(heading);
    const rows = el("div", "comparison-rows");
    const max = metric.key === "reviews" ? Math.max(1, ...courses.map((course) => course.reviews || 0)) : ratingMax;
    for (const course of courses) {
      const value = course[metric.key];
      const row = el("button", "comparison-row");
      row.type = "button";
      row.setAttribute("aria-label", "View " + displayCode(course.code));
      row.append(el("span", "bar-course", displayCode(course.code)));
      const track = el("span", "bar-track");
      const fill = el("span", "bar-fill");
      fill.style.width = value === null ? "0%" : Math.max(0, Math.min(100, value / max * 100)) + "%";
      track.append(fill);
      row.append(track, el("strong", "bar-value", value === null ? "\u2014" :
        metric.key === "reviews" ? value.toLocaleString() : formatScore(value) + " / " + ratingMax));
      row.addEventListener("click", () => {
        selectedCode = course.code;
        activeView = "course";
        renderView();
        renderSidebar();
        renderSelected();
      });
      rows.append(row);
    }
    card.append(rows);
    grid.append(card);
  }
}

function renderSidebar() {
  courseList.replaceChildren();
  const compareButton = el("button", "course-button compare-button" + (activeView === "compare" ? " active" : ""), "Compare all courses");
  compareButton.type = "button";
  compareButton.addEventListener("click", () => {
    activeView = "compare";
    renderView();
    renderSidebar();
  });
  courseList.append(compareButton);
  if (!courses.length) {
    courseList.append(el("p", "sidebar-empty", "Courses will appear here when data is connected."));
    return;
  }
  for (const course of courses) {
    const button = el("button", "course-button" + (course.code === selectedCode ? " active" : ""));
    button.type = "button";
    button.setAttribute("aria-label", "Show " + displayCode(course.code));
    const label = el("span");
    label.append(el("strong", "", displayCode(course.code)), el("small", "", "UBC Computer Science"));
    button.append(label, el("span", "arrow", ">"));
    button.addEventListener("click", () => {
      selectedCode = course.code;
      activeView = "course";
      renderView();
      renderSidebar();
      renderSelected();
    });
    courseList.append(button);
  }
}

function renderSelected() {
  const course = courses.find((item) => item.code === selectedCode);
  if (!course) return;
  for (const card of document.querySelectorAll(".metric-card")) {
    card.classList.remove("flash");
    void card.offsetWidth;
    card.classList.add("flash");
  }
  document.querySelector("#course-position").textContent =
    String(courses.indexOf(course) + 1).padStart(2, "0") + " / " + String(courses.length).padStart(2, "0");
  document.querySelector("#selected-code").textContent = displayCode(course.code);
  document.querySelector("#selected-name").textContent = "UBC / COMPUTER SCIENCE";
  setRing("easiness", course.easiness, "Easiness");
  setRing("interest", course.interest, "Interest");
  setRing("usefulness", course.usefulness, "Usefulness");
  document.querySelector("#rating-summary").textContent =
    "Easiness " + formatScore(course.easiness) + " / Interest " + formatScore(course.interest) +
    " / Usefulness " + formatScore(course.usefulness) + " out of " + ratingMax + ".";
  document.querySelector("#review-count").textContent =
    course.reviews === null ? "\u2014" : course.reviews.toLocaleString();
  const sourceLinks = document.querySelector("#source-links");
  sourceLinks.replaceChildren();
  for (const source of course.sources) {
    const url = safeUrl(source);
    if (!url) continue;
    const link = el("a", "", url.hostname + " >");
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = url.href;
    sourceLinks.append(link);
  }
  if (!sourceLinks.children.length) sourceLinks.append(el("span", "", "No source links available."));
}

async function loadData() {
  if (loading) return;
  loading = true;
  try {
    const response = await fetch("/api/courses", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load course data.");
    const signature = JSON.stringify(payload);
    loadError.textContent = "";
    if (signature === lastSignature) return;
    lastSignature = signature;
    courses = recordsToCourses(payload);
    if (!courses.some((course) => course.code === selectedCode)) selectedCode = courses[0]?.code || "";
    renderSummary(payload);
    renderSidebar();
    renderComparison();
    if (courses.length) renderSelected();
  } catch (error) {
    loadError.textContent = error.message || "Could not load course data.";
    document.querySelector("#connection-label").textContent = "CONNECTION ERROR";
  } finally {
    loading = false;
  }
}

document.querySelector("#compare-tab").addEventListener("click", () => {
  activeView = "compare";
  renderView();
  renderSidebar();
});
document.querySelector("#course-tab").addEventListener("click", () => {
  activeView = "course";
  renderView();
  renderSidebar();
});
loadData();
setInterval(loadData, 3000);
