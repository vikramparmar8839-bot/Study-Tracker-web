// =============================================================
// syllabusParser.js — heuristic syllabus parser
//
// Works on two broad families of PDFs:
//   1. College schemes  (course code/name -> Unit I..V -> topics)
//   2. Entrance exams   (JEE / NEET style: PHYSICS -> Unit 1..N -> topics)
//
// Output shape (used by the app):
//   { groups: [ { id, label, subjects: [
//       { id, code, name, units: [ { id, name, topics: [ {id,name,completed} ] } ] }
//   ] } ] }
// Groups are semesters for college PDFs, or one "Syllabus" group otherwise.
// =============================================================

const ROMAN = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10,
  XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15, XVI: 16, XVII: 17, XVIII: 18,
  XIX: 19, XX: 20,
};

const STOP_RE = new RegExp(
  "\\b(?:" +
    [
      "course\\s+outcomes?",
      "books?\\s+recommended",
      "recommended\\s+books?",
      "text\\s*/?\\s*reference\\s+books?",
      "text\\s*books?",
      "reference\\s+books?",
      "suggested\\s+reading",
      "list\\s+of\\s+experiments",
      "list\\s+of\\s+practicals?",
      "co\\.?\\s*no\\.?",
      "course\\s+learning\\s+objectives?",
      "course\\s+objectives?",
      "learning\\s+resources",
      "total\\s+hours",
      "scheme\\s+of\\s+examination",
      "sample\\s+questions",
    ].join("|") +
    ")",
  "i"
);

const UNIT_RE =
  /(?:^|(?<=[.;:]\s))[ \t]*\b(UNIT|Unit|MODULE|Module|CHAPTER|Chapter)[ \t]*[-–—‑.:]?[ \t]*(\d{1,2}|[IVX]{1,5})\b[ \t]*[:\-–—.)]?[ \t]*([^\n]*)/gm;

const SEMESTER_RE =
  /^\s*(?:semester|sem\.?)\s*[-–:]?\s*(I{1,3}|IV|VI{0,3}|IX|X|1[0-2]|[1-9])\s*$/i;

const CLASS_RE = /^\s*class\s*[-–:]?\s*(XII|XI|12|11)(?:th)?\b/i;

const SUBJECT_HEAD_RE =
  /^(?:syllabus\s+(?:for|of)\s+)?(?:section\s+[a-z0-9]\s*[-–:]?\s*)?(physics|chemistry|mathematics|maths|math|biology|botany|zoology)(?:\s*(?:section\s*[a-z0-9]+|syllabus|\([^)]*\)|[-–:].{0,30}))?\s*:?$/i;

const SUBJECT_CANON = {
  physics: "Physics",
  chemistry: "Chemistry",
  mathematics: "Mathematics",
  maths: "Mathematics",
  math: "Mathematics",
  biology: "Biology",
  botany: "Botany",
  zoology: "Zoology",
};

// ---------------------------------------------------------------
// helpers
// ---------------------------------------------------------------

function unitNumber(token) {
  return /^\d/.test(token) ? parseInt(token, 10) : ROMAN[token];
}

function isHeadingLike(s) {
  const t = s.trim();
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3) return false;
  if (t === t.toUpperCase()) return true;
  const words = t.split(/\s+/).filter((w) => w.length > 3);
  if (!words.length) return false;
  const caps = words.filter((w) => /^[A-Z(]/.test(w)).length;
  return caps / words.length >= 0.7;
}

function cleanTopic(text) {
  return text
    .replace(/^[•●▪◦○■□➢➤✓*\-–—:,.\s]+/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/[\s.,;:]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHours(text) {
  return text.replace(
    /[(\[]?\s*\d{1,2}\s*(?:hrs?\.?|hours?|lectures?|periods?)\s*[)\]]?/gi,
    " "
  );
}

function splitTopLevelCommas(text) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  // merge short fragments ("wet", "need") forward into the next item
  const items = out.map((x) => x.trim()).filter(Boolean);
  const merged = [];
  let carry = "";
  items.forEach((p, i) => {
    const cur = carry ? carry + ", " + p : p;
    if (cur.length < 15 && i < items.length - 1) carry = cur;
    else {
      merged.push(cur);
      carry = "";
    }
  });
  return merged;
}

export function splitTopics(body) {
  let text = stripHours(body);
  let parts;
  const numbered = text.match(/(?:^|\n)\s*\d{1,2}[.)]\s+\S/g);
  if (/(^|\n)\s*[•●▪◦○■□➢➤✓*]\s+/.test(text)) {
    parts = text.split(/\n?\s*[•●▪◦○■□➢➤✓*]\s+/);
  } else if (numbered && numbered.length >= 3) {
    parts = text.split(/(?:^|\n)\s*\d{1,2}[.)]\s+/);
  } else {
    const flat = text
      .replace(/([a-z])-\s*\n\s*([a-z])/g, "$1$2")
      .replace(/\s*\n\s*/g, " ");
    parts = flat.split(/;|\s[-–—]\s|(?<![A-Za-z]\.[a-z])\.\s+(?=[A-Z(])/);
  }
  const topics = [];
  for (const raw of parts) {
    const t = cleanTopic(raw);
    if (t.length <= 2) continue;
    if (t.length > 110 && t.split(",").length >= 5)
      topics.push(...splitTopLevelCommas(t).map(cleanTopic).filter((x) => x.length > 2));
    else topics.push(t);
  }
  return topics;
}

// a title is short, has few commas, and doesn't look like a wrapped sentence
function looksLikeTitle(t) {
  const x = t.trim();
  if (x.length < 3 || x.length > 65) return false;
  if ((x.match(/,/g) || []).length > 3) return false;
  if (/;/.test(x) || /\s[-–—]\s/.test(x) || /[A-Za-z][-–—]\s/.test(x)) return false;
  if (/\b(?:and|or|of|the|in|to|for|with|a|an|on|by|&)$/i.test(x)) return false;
  return isHeadingLike(x);
}

function splitTitle(content) {
  content = content.replace(/^[ \t]*\n+/, "");
  const nl = content.indexOf("\n");
  const first = (nl === -1 ? content : content.slice(0, nl)).trim();
  const rest = nl === -1 ? "" : content.slice(nl + 1);

  const colon = first.indexOf(":");
  if (colon > 0 && looksLikeTitle(first.slice(0, colon))) {
    return {
      title: cleanTopic(first.slice(0, colon)),
      body: first.slice(colon + 1) + "\n" + rest,
    };
  }
  if (first && !/[.]$/.test(first) && rest.trim() && looksLikeTitle(first)) {
    return { title: cleanTopic(first), body: rest };
  }
  return { title: "", body: content };
}

function cutAtStop(text) {
  const m = STOP_RE.exec(text);
  return m ? text.slice(0, m.index) : text;
}

function titleCase(s) {
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(And|Of|The|In|To|For|On)\b/g, (w) => w.toLowerCase());
}

function slug(s) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30) || "s"
  );
}

function lineIndex(text) {
  const lines = text.split("\n");
  let pos = 0;
  return lines.map((line) => {
    const entry = { line, idx: pos };
    pos += line.length + 1;
    return entry;
  });
}

// ---------------------------------------------------------------
// PDF text extraction (keeps line breaks, strips repeated headers)
// ---------------------------------------------------------------

export async function extractPdfText(pdfjsLib, file) {
  if (!file) throw new Error("No PDF file selected.");
  const buf = await file.arrayBuffer();
  if (!buf || buf.byteLength === 0) throw new Error("The selected PDF file is empty.");

  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buf),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const lines = [];
    let cur = "";
    let lastY = null;
    let prevEnd = null;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const x = item.transform ? item.transform[4] : undefined;
      const y = item.transform ? item.transform[5] : undefined;
      const size = item.height || 10;
      const tol = Math.max(3, size * 0.6);
      if (lastY !== null && y !== undefined && Math.abs(y - lastY) > tol && cur.trim()) {
        lines.push(cur);
        cur = "";
        prevEnd = null;
      }
      let sep = "";
      if (cur && item.str && !cur.endsWith(" ") && !item.str.startsWith(" ")) {
        // PDF.js often splits one word ("PRACTI" "C" "E") into several items.
        // Only add a space when there is a real horizontal gap between them.
        if (prevEnd !== null && x !== undefined && item.width > 0 && prevEnd > 0)
          sep = x - prevEnd > size * 0.15 ? " " : "";
        else sep = " ";
      }
      cur += sep + item.str;
      if (y !== undefined) lastY = y;
      prevEnd = x !== undefined && item.width > 0 ? x + item.width : null;
      if (item.hasEOL) {
        lines.push(cur);
        cur = "";
        lastY = null;
        prevEnd = null;
      }
    }
    if (cur.trim()) lines.push(cur);
    pages.push(lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean));
  }

  const text = stripRepeatedLines(pages);
  if (!text.trim()) {
    throw new Error(
      "PDF opened, but no selectable text was found. It may be a scanned image (OCR is not supported)."
    );
  }
  return text;
}

export function stripRepeatedLines(pages) {
  const key = (l) => l.toLowerCase().replace(/\d+/g, "#").trim();
  const counts = new Map();
  for (const lines of pages) {
    for (const k of new Set(lines.map(key))) counts.set(k, (counts.get(k) || 0) + 1);
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.4));
  const pageNo = /^\s*(?:page\s*)?\d+(?:\s*(?:of|\/)\s*\d+)?\s*$/i;
  return pages
    .map((lines) =>
      lines
        .filter((l) => !pageNo.test(l))
        .filter((l) => !(pages.length >= 3 && l.length < 200 && counts.get(key(l)) >= threshold))
        .join("\n")
    )
    .join("\n");
}

// ---------------------------------------------------------------
// course-header detection for college-style PDFs
// ---------------------------------------------------------------

// course codes like 1RABS1, CS301, ME-204, BT 101
const CODE_SRC =
  "(?:(?=[A-Z0-9]*\\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5,9}|[A-Z]{2,5}[- ]\\d{3,4}[A-Z]?)";
const HEADER_LINE_RE = new RegExp("^(" + CODE_SRC + ")(?![A-Za-z0-9])\\s*[:\\-–]?\\s*(.*)$");
const ROW_RE = new RegExp("^\\d{1,2}[.)]?\\s+(" + CODE_SRC + ")(?![A-Za-z0-9])\\s*(.*)$");
const HEADER_JUNK_RE =
  /(course\s+code|instructions?|hours\s*per|credits?|semester|common\s+to\s+all|branches?|b\.?\s?tech|university|institute|vishwavidyalaya|faculty|department|\byear\b)/i;
const NAME_STOP_LINE_RE =
  /^(?:L\s*T\s*[PT]\b|duration|course|prerequisites?|pre\s*requisite|credits?|hours|instructions?|objectives?)/i;
const CONTENT_LABEL_RE = /^(?:course\s+(?:of\s+)?contents?|detailed\s+syllabus|syllabus)\s*:?\s*$/i;
const GENERIC_HEADING_RE =
  /^(?:course\s+(?:of\s+)?contents?|course\s+syllabus|syllabus|contents?|units?|detailed\s+syllabus|learning\s+objectives?|prerequisites?)\b/i;

// reads a (possibly wrapped) course name that follows a course code
function collectName(rest, lines, startIdx) {
  const parts = [];
  const feed = (raw) => {
    let t = raw.trim();
    if (!t) return false;
    if (NAME_STOP_LINE_RE.test(t) || /^\d/.test(t) || /^[A-Z]{2,4}\s+\d/.test(t)) return false;
    const cut = t.search(/\s+(?:[A-Z]{2,4}\s+)?\d/);
    if (cut >= 0) {
      t = t.slice(0, cut).trim();
      if (t) parts.push(t);
      return false;
    }
    parts.push(t);
    return true;
  };
  let cont = rest ? feed(rest) : true;
  for (let k = startIdx; cont && k < lines.length && parts.length < 4; k++) {
    cont = feed(lines[k].line);
  }
  return parts
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/^L\s+(?:Week\s+)?T\s+P\b(?:\s+L\s+T\s+P(?:\s+Total)?)?\s*/, "")
    .replace(/\b(?:L\s*T\s*[PT]|B\.?\s?Tech|Common\s+to\s+all|Instructions?|Hours\s+per|Semester)\b.*$/i, "")
    .replace(/[\s:\-–&]+$/, "")
    .trim();
}

// every line that starts with a course code and has a name = one course header
function findHeaders(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = HEADER_LINE_RE.exec(lines[i].line.trim());
    if (!m) continue;
    const name = collectName(m[2], lines, i + 1);
    if (name.replace(/[^A-Za-z]/g, "").length < 3) continue;
    let j = i - 1;
    while (j >= 0 && i - j <= 10 && HEADER_JUNK_RE.test(lines[j].line)) j--;
    out.push({
      idx: lines[i].idx,
      code: m[1].replace(/\s+/g, ""),
      name,
      blockStart: lines[j + 1].idx,
    });
  }
  return out;
}

// scheme tables: "Semester-I" followed by rows "1 1RABS1 COURSE NAME ..."
function findScheduleTables(lines, semesterEvents) {
  const entries = [];
  for (const ev of semesterEvents) {
    const rows = [];
    const start = ev.lineNo + 1;
    for (let i = start; i < Math.min(lines.length, start + 60); i++) {
      const t = lines[i].line.trim();
      if (/^total\s+credits/i.test(t) || SEMESTER_RE.test(t)) break;
      const m = ROW_RE.exec(t);
      if (m)
        rows.push({
          code: m[1].replace(/\s+/g, ""),
          name: collectName(m[2], lines, i + 1),
          label: ev.label,
        });
    }
    if (rows.length >= 3) entries.push(...rows);
  }
  return entries;
}

const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, "");

function matchTable(entries, code, name) {
  if (!entries.length) return null;
  const byCode = code && entries.find((e) => e.code === code);
  if (byCode) return byCode;
  const n = norm(name || "");
  if (n.length < 6) return null;
  const exact = entries.find((e) => norm(e.name) === n);
  if (exact) return exact;
  return (
    entries.find((e) => {
      const m = norm(e.name);
      if (m.length < 6) return false;
      const [short, long] = m.length <= n.length ? [m, n] : [n, m];
      if (!long.startsWith(short)) return false;
      return !/^[ivx0-9]*$/.test(long.slice(short.length)); // avoid Maths-I vs Maths-II
    }) || null
  );
}

// fallback when a PDF has no course codes: look at the text before the first unit
function findFallbackName(gap) {
  const labeled =
    /(?:(?:Course|Subject|Paper)\s*(?:Title|Name)|Title\s+of\s+the\s+(?:Course|Subject|Paper)|Name\s+of\s+the\s+(?:Course|Subject|Paper))\s*[:\-–]\s*([^\n]{3,90})/gi;
  let best = null;
  for (const m of gap.matchAll(labeled)) {
    const name = m[1].replace(/\s{2,}.*/, "").replace(/[\s:\-–,]+$/, "").trim();
    if (name.length >= 3) best = { name, index: m.index };
  }
  if (best) return best;

  let region = gap;
  const stops = [...gap.matchAll(new RegExp(STOP_RE.source, "gi"))];
  region = stops.length ? gap.slice(stops[stops.length - 1].index) : gap.slice(-300);
  const lines = region.split("\n");
  let off = gap.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    off -= lines[i].length + 1;
    const l = lines[i].trim();
    if (
      l.length >= 4 &&
      l.split(/\s+/).length <= 8 &&
      !/[:;.]$/.test(l) &&
      !/\d/.test(l) &&
      !STOP_RE.test(l) &&
      !GENERIC_HEADING_RE.test(l) &&
      !HEADER_JUNK_RE.test(l) &&
      isHeadingLike(l)
    )
      return { name: l, index: Math.max(off, 0) };
  }
  return null;
}

// ---------------------------------------------------------------
// main entry
// ---------------------------------------------------------------

// "1R ABS1" -> "1RABS1", "R2 SES3" -> "R2SES3" (PDF.js sometimes splits codes)
export function fixSplitCodes(t) {
  return t.replace(/\b(\d[A-Z]|[A-Z]\d) ([A-Z]{2,4}\d{1,2})\b/g, "$1$2");
}

export function parseSyllabus(rawText) {
  const text = fixSplitCodes(rawText.replace(/\r/g, "").replace(/[ \t]+/g, " "));
  const warnings = [];
  const lines = lineIndex(text);

  // structural events -------------------------------------------------
  const subjectEvents = [];
  const semesterEvents = [];
  const classEvents = [];
  for (let li = 0; li < lines.length; li++) {
    const { line, idx } = lines[li];
    const l = line.trim();
    if (!l || l.split(/\s+/).length > 7) continue;
    const sm = SUBJECT_HEAD_RE.exec(l);
    if (sm) subjectEvents.push({ idx, name: SUBJECT_CANON[sm[1].toLowerCase()] });
    const se = SEMESTER_RE.exec(l);
    if (se) semesterEvents.push({ idx, lineNo: li, label: `Semester ${se[1].toUpperCase()}` });
    const ce = CLASS_RE.exec(l);
    if (ce) classEvents.push({ idx, label: `Class ${ce[1].toUpperCase()}` });
  }

  const rawMarkers = [];
  for (const m of text.matchAll(UNIT_RE)) {
    const n = unitNumber(m[2]);
    if (n === undefined) continue;
    const bodyStart = m.index + m[0].length - m[3].length;
    rawMarkers.push({ index: m.index, bodyStart, n, token: m[2], word: m[1] });
  }

  const distinctSubjects = new Set(subjectEvents.map((e) => e.name));
  const examMode = distinctSubjects.size >= 2 && findHeaders(lines).length < 3;

  const result = examMode
    ? parseExamStyle(text, rawMarkers, subjectEvents, classEvents, warnings)
    : parseCollegeStyle(text, lines, rawMarkers, semesterEvents, warnings);

  // drop empty things and compute stats ------------------------------
  const groups = result.groups
    .map((g) => ({
      ...g,
      subjects: g.subjects
        .map((s) => ({ ...s, units: s.units.filter((u) => u.topics.length > 0) }))
        .filter((s) => s.units.length > 0),
    }))
    .filter((g) => g.subjects.length > 0);

  const subjects = groups.flatMap((g) => g.subjects);
  const units = subjects.flatMap((s) => s.units);
  const topics = units.flatMap((u) => u.topics);

  if (subjects.length === 0) {
    warnings.push(
      "No units or topics could be detected. The PDF may be a scanned image, or it uses a layout without 'Unit' / 'Module' headings."
    );
  }

  return {
    syllabus: { groups },
    warnings,
    stats: {
      mode: examMode ? "entrance-exam" : "college",
      subjects: subjects.length,
      units: units.length,
      topics: topics.length,
    },
  };
}

// ---------------------------------------------------------------
// entrance-exam style (JEE / NEET)
// ---------------------------------------------------------------

function parseExamStyle(text, markers, subjectEvents, classEvents, warnings) {
  const bySubject = new Map(); // name -> subject
  const order = [];
  const getSubject = (name) => {
    if (!bySubject.has(name)) {
      const s = { id: slug(name), code: "", name, units: [], _free: "" };
      bySubject.set(name, s);
      order.push(s);
    }
    return bySubject.get(name);
  };

  // boundaries: each subject event runs until the next *different* event
  const events = subjectEvents.slice().sort((a, b) => a.idx - b.idx);
  const ranges = [];
  if (events.length && markers.some((m) => m.index < events[0].idx)) {
    ranges.push({ name: "General", start: 0, end: events[0].idx });
  }
  events.forEach((e, i) => {
    const end = i + 1 < events.length ? events[i + 1].idx : text.length;
    ranges.push({ name: e.name, start: e.idx, end });
  });
  if (!events.length) ranges.push({ name: "General", start: 0, end: text.length });

  for (const r of ranges) {
    const subject = getSubject(r.name);
    const inRange = markers.filter((m) => m.index >= r.start && m.index < r.end);
    if (inRange.length === 0) {
      subject._free += "\n" + text.slice(r.start, r.end);
      continue;
    }
    inRange.forEach((mk, k) => {
      const end = k + 1 < inRange.length ? inRange[k + 1].index : r.end;
      const content = cutAtStop(text.slice(mk.bodyStart, end));
      const { title, body } = splitTitle(content);
      const cls = [...classEvents].filter((c) => c.idx < mk.index).pop();
      const unitIdx = subject.units.length;
      const unitId = `${subject.id}-u${unitIdx}`;
      const label = `${cls ? cls.label + " · " : ""}Unit ${mk.token.toUpperCase()}`;
      subject.units.push({
        id: unitId,
        name: title ? `${label} – ${titleCase(title)}` : label,
        topics: splitTopics(body).map((name, t) => ({
          id: `${unitId}-t${t}`,
          name,
          completed: false,
        })),
      });
    });
  }

  // fallback for subjects with no unit headings (e.g. JEE Advanced)
  for (const s of order) {
    if (s.units.length === 0 && s._free.trim().length > 150) {
      const unitId = `${s.id}-u0`;
      const body = cutAtStop(s._free.replace(/^\s*[^\n]*\n/, ""));
      s.units.push({
        id: unitId,
        name: "All topics",
        topics: splitTopics(body).map((name, t) => ({
          id: `${unitId}-t${t}`,
          name,
          completed: false,
        })),
      });
      warnings.push(`${s.name}: no unit headings found, so all topics were grouped into one unit.`);
    }
    delete s._free;
  }

  return { groups: [{ id: "all", label: "Syllabus", subjects: order }] };
}

// ---------------------------------------------------------------
// college style (course -> Unit I..V)
// ---------------------------------------------------------------

function parseCollegeStyle(text, lines, rawMarkers, semesterEvents, warnings) {
  // 1) keep only markers that continue a unit sequence or restart at 1
  const markers = [];
  let prev = 0;
  let ignored = 0;
  for (const m of rawMarkers) {
    if (prev === 0 || m.n === 1 || m.n === prev + 1) {
      markers.push({ ...m, newSubject: m.n === 1 || prev === 0 });
      prev = m.n;
    } else ignored++;
  }
  if (ignored > 0)
    warnings.push(`Ignored ${ignored} unit-like reference(s) that didn't fit the unit numbering.`);
  if (markers.length === 0) return { groups: [] };

  // 2) subject candidates = runs of units (numbering restarts at 1)
  const subjects = [];
  markers.forEach((mk) => {
    if (mk.newSubject) subjects.push({ markers: [mk], idx: mk.index });
    else subjects[subjects.length - 1].markers.push(mk);
  });

  // 3) course headers (code + name) and the semester table
  const headers = findHeaders(lines);
  const table = findScheduleTables(lines, semesterEvents);

  // 4) pair headers with subjects by reading order. A header normally comes
  //    just before its units, but some PDFs print it after them.
  const tokens = [
    ...headers.map((h) => ({ type: "H", idx: h.idx, h })),
    ...subjects.map((sub) => ({ type: "G", idx: sub.idx, sub })),
  ].sort((a, b) => a.idx - b.idx);

  let pending = null;
  const waiting = [];
  const orphans = [];
  for (const t of tokens) {
    if (t.type === "H") {
      if (waiting.length) waiting.shift().header = t.h;
      else {
        if (pending) orphans.push(pending);
        pending = t.h;
      }
    } else if (pending) {
      t.sub.header = pending;
      pending = null;
    } else waiting.push(t.sub);
  }
  if (pending) orphans.push(pending);

  // 5) fallback names for subjects that got no header
  let unnamed = 0;
  const cuts = headers.map((h) => h.blockStart);
  subjects.forEach((sub, k) => {
    if (sub.header) return;
    const gapStart = k > 0 ? subjects[k - 1].markers[0].bodyStart : 0;
    const gap = text.slice(gapStart, sub.idx);
    const fb = findFallbackName(gap);
    if (fb) {
      sub.fallbackName = titleCase(fb.name);
      cuts.push(gapStart + fb.index);
    } else unnamed++;
  });

  // 6) unit end positions
  subjects.forEach((sub) => {
    sub.markers.forEach((mk, k) => {
      const next = sub.markers[k + 1];
      const nextSub = subjects[subjects.indexOf(sub) + 1];
      let end = next ? next.index : nextSub ? nextSub.idx : text.length;
      for (const c of cuts) if (c > mk.bodyStart && c < end) end = Math.min(end, c);
      mk.end = Math.max(end, mk.bodyStart);
    });
  });

  // 7) build output
  const groupsMap = new Map();
  const groupOrder = [];
  const usedIds = new Set();
  const built = [];

  const pickGroup = (code, name, lastLabel) => {
    const entry = matchTable(table, code, name);
    return entry ? entry.label : lastLabel || (table[0] ? table[0].label : "Syllabus");
  };
  const uniqueId = (base) => {
    let id = base;
    while (usedIds.has(id)) id += "-x";
    usedIds.add(id);
    return id;
  };

  let lastLabel = null;
  subjects.forEach((sub, i) => {
    const header = sub.header;
    let name = header
      ? titleCase(header.name)
      : sub.fallbackName || `Subject ${i + 1}`;
    const code = header ? header.code : "";
    // complete a truncated header name from the scheme table
    const tEntry = header ? matchTable(table, code, null) : null;
    if (tEntry && norm(tEntry.name).startsWith(norm(name)) && tEntry.name.length > name.length + 2)
      name = titleCase(tEntry.name);
    const label = pickGroup(code, name, lastLabel);
    lastLabel = label;
    const id = uniqueId(code || slug(name));
    const units = sub.markers.map((mk, k) => {
      const content = cutAtStop(text.slice(mk.bodyStart, mk.end));
      const { title, body } = splitTitle(content);
      const unitId = `${id}-u${k}`;
      return {
        id: unitId,
        name: title
          ? `Unit ${mk.token.toUpperCase()} – ${titleCase(title)}`
          : `Unit ${mk.token.toUpperCase()}`,
        topics: splitTopics(body).map((n, t) => ({ id: `${unitId}-t${t}`, name: n, completed: false })),
      };
    });
    built.push({ label, order: sub.idx, subject: { id, code, name, units } });
  });

  // 8) courses that have a header but no "Unit" headings (labs, workshops)
  const labels = [];
  lines.forEach(({ line, idx }) => {
    if (CONTENT_LABEL_RE.test(line.trim())) labels.push({ idx, end: idx + line.length });
  });
  for (const o of orphans) {
    const pos = headers.indexOf(o);
    const low = pos > 0 ? headers[pos - 1].idx : 0;
    let found = null;
    for (const L of labels) {
      if (L.idx <= low || L.idx >= o.blockStart) continue;
      let contentEnd = text.length;
      const stop = new RegExp(STOP_RE.source, "i").exec(text.slice(L.end));
      if (stop) contentEnd = L.end + stop.index;
      for (const c of cuts) if (c > L.idx && c < contentEnd) contentEnd = c;
      const claimed = markers.some((m) => m.index > L.idx && m.index < contentEnd);
      if (!claimed) found = { L, contentEnd };
    }
    if (!found) continue;
    const topics = splitTopics(text.slice(found.L.end, found.contentEnd));
    if (topics.length === 0) continue;
    const name = titleCase(o.name);
    const id = uniqueId(o.code || slug(name));
    const unitId = `${id}-u0`;
    built.push({
      label: pickGroup(o.code, name, null),
      order: found.L.idx,
      subject: {
        id,
        code: o.code,
        name,
        units: [
          {
            id: unitId,
            name: "Course Contents",
            topics: topics.map((n, t) => ({ id: `${unitId}-t${t}`, name: n, completed: false })),
          },
        ],
      },
    });
  }

  built.sort((a, b) => a.order - b.order);
  for (const b of built) {
    if (!groupsMap.has(b.label)) {
      const g = { id: slug(b.label), label: b.label, subjects: [] };
      groupsMap.set(b.label, g);
      groupOrder.push(g);
    }
    groupsMap.get(b.label).subjects.push(b.subject);
  }

  if (unnamed > 0)
    warnings.push(
      `Could not detect the name of ${unnamed} subject(s); they are called "Subject N". You can still track them.`
    );
  if (orphans.length && built.length < subjects.length + orphans.length)
    warnings.push("Some courses have a header but no unit list, so they were skipped.");

  return { groups: groupOrder };
}

// ---------------------------------------------------------------
// helpers for the app
// ---------------------------------------------------------------

// Converts old saved data ({semester1, semester2}) to the new shape.
export function normalizeSyllabus(s) {
  if (!s) return null;
  if (Array.isArray(s.groups)) return s;
  const groups = [];
  if (s.semester1?.length) groups.push({ id: "semester-i", label: "Semester I", subjects: s.semester1 });
  if (s.semester2?.length) groups.push({ id: "semester-ii", label: "Semester II", subjects: s.semester2 });
  return groups.length ? { groups } : null;
}

export function getAllSubjects(s) {
  const n = normalizeSyllabus(s);
  return n ? n.groups.flatMap((g) => g.subjects) : [];
}
