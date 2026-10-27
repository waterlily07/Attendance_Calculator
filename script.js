/* ===== Attendance Calculator ===== */

const MAX_CLASSES = 1000;
const DEFAULT_REQUIRED = 75;
// Borderline = still above the requirement, but with this many spare classes or fewer.
const BORDERLINE_BUFFER = 1;

const defaultSubjects = [
  { name: 'Web Technology', total: 40, attended: 32, required: 75 },
  { name: 'DBMS', total: 35, attended: 25, required: 75 },
  { name: 'Operating Systems', total: 30, attended: 20, required: 75 }
];

/* ---------- helpers ---------- */

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function toNumber(value) {
  const text = String(value ?? '').trim();
  return text === '' ? NaN : Number(text);
}

function plural(n, word = 'class', suffix = 'es') {
  return `${n} ${word}${n === 1 ? '' : suffix}`;
}

function formatPercent(p) {
  return `${Number(p.toFixed(1))}%`;
}

function statusLabel(status) {
  return { safe: 'Safe', warning: 'Borderline', danger: 'At Risk' }[status] || 'No Data';
}

function statusClass(status) {
  return status === 'safe' ? 'safe' : status === 'danger' ? 'danger' : 'warning';
}

/* ---------- validation ----------
   Takes the RAW text from the inputs and returns:
   - errors: messages to show the user (keyed by field)
   - values: safe numbers that are always OK to calculate with */

function validateRaw(raw) {
  const t = toNumber(raw.total);
  const a = toNumber(raw.attended);
  const r = toNumber(raw.required);
  const errors = {};

  if (Number.isNaN(t)) errors.total = 'Enter the total classes held.';
  else if (t < 0) errors.total = 'Total classes cannot be negative.';
  else if (!Number.isInteger(t)) errors.total = 'Total classes must be a whole number.';
  else if (t > MAX_CLASSES) errors.total = `Total classes cannot be more than ${MAX_CLASSES}.`;

  const total = Number.isFinite(t) ? clampNumber(Math.round(t), 0, MAX_CLASSES) : 0;

  if (Number.isNaN(a)) errors.attended = 'Enter the classes attended.';
  else if (a < 0) errors.attended = 'Classes attended cannot be negative.';
  else if (!Number.isInteger(a)) errors.attended = 'Classes attended must be a whole number.';
  else if (a > total) errors.attended = 'Classes attended cannot be more than total classes.';

  const attended = Number.isFinite(a) ? clampNumber(Math.round(a), 0, total) : 0;

  if (Number.isNaN(r)) errors.required = 'Enter the required attendance %.';
  else if (r < 1 || r > 100) errors.required = 'Required attendance must be between 1 and 100.';

  const required = Number.isFinite(r)
    ? Math.round(clampNumber(r, 1, 100) * 10) / 10
    : DEFAULT_REQUIRED;

  return { errors, values: { total, attended, required } };
}

function firstError(errors) {
  return errors.total || errors.attended || errors.required || '';
}

function normalizeSubject(subject) {
  const { values } = validateRaw(subject);
  return { name: String(subject?.name || 'Subject').slice(0, 30), ...values };
}

/* ---------- calculation ----------
   Uses whole numbers only (required % is scaled by 10) so decimals such as
   70% never cause floating point rounding mistakes. */

function calculateAttendance(total, attended, required) {
  if (total <= 0) {
    return {
      percentage: 0, status: 'nodata', buffer: 0, need: 0,
      message: 'Enter the number of classes held to see your attendance.'
    };
  }

  const percentage = (attended / total) * 100;
  const reqTenths = Math.round(required * 10);          // 75% -> 750

  if (attended * 1000 >= reqTenths * total) {
    // buffer = floor(attended / r - total)
    const buffer = Math.floor((1000 * attended - reqTenths * total) / reqTenths);
    const status = buffer <= BORDERLINE_BUFFER ? 'warning' : 'safe';

    let message;
    if (buffer === 0) message = 'You are right at the limit. Missing even one more class puts you at risk.';
    else if (status === 'warning') message = `Only ${plural(buffer)} of buffer left. Be careful about missing more.`;
    else message = `You can miss ${plural(buffer)} more and still stay above ${required}%.`;

    return { percentage, status, buffer, need: 0, message };
  }

  if (reqTenths >= 1000) {
    return {
      percentage, status: 'danger', buffer: 0, need: null,
      message: 'With 100% required, a missed class cannot be recovered.'
    };
  }

  // need = ceil((r * total - attended) / (1 - r))
  const need = Math.ceil((reqTenths * total - 1000 * attended) / (1000 - reqTenths));
  return {
    percentage, status: 'danger', buffer: 0, need,
    message: `Attend ${plural(need)} in a row to get back to ${required}%.`
  };
}

/* ---------- state + elements ---------- */

const state = {
  subjects: defaultSubjects.map(normalizeSubject),
  activeSubjectIndex: 0
};

const subjectList = document.getElementById('subjectList');
const statusPill = document.getElementById('statusPill');
const currentPercentage = document.getElementById('currentPercentage');
const summaryAttendance = document.getElementById('summaryAttendance');
const bufferValue = document.getElementById('bufferValue');
const needValue = document.getElementById('needValue');
const resultMessage = document.getElementById('resultMessage');
const mainError = document.getElementById('mainError');
const themeButtons = document.querySelectorAll('.theme-btn');

const subjectNameInput = document.getElementById('subjectName');
const totalClassesInput = document.getElementById('totalClasses');
const attendedClassesInput = document.getElementById('attendedClasses');
const requiredPercentInput = document.getElementById('requiredPercent');

const mainInputs = {
  total: totalClassesInput,
  attended: attendedClassesInput,
  required: requiredPercentInput
};

/* ---------- theme ---------- */

function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  themeButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.theme === theme);
  });
  try { localStorage.setItem('attendance-theme', theme); } catch (e) { /* storage unavailable */ }
}

function initializeTheme() {
  let saved = 'light';
  try { saved = localStorage.getItem('attendance-theme') || 'light'; } catch (e) { /* ignore */ }
  applyTheme(saved);
}

/* ---------- main calculator panel ---------- */

function setMainErrors(errors) {
  mainError.textContent = firstError(errors);
  Object.entries(mainInputs).forEach(([field, input]) => {
    input.classList.toggle('invalid', Boolean(errors[field]));
  });
}

function writeMainInputs(values) {
  totalClassesInput.value = values.total;
  attendedClassesInput.value = values.attended;
  requiredPercentInput.value = values.required;
}

function updateMain() {
  const s = state.subjects[state.activeSubjectIndex];
  const result = calculateAttendance(s.total, s.attended, s.required);

  currentPercentage.textContent = formatPercent(result.percentage);
  summaryAttendance.textContent = `${result.percentage.toFixed(2)}%`;
  resultMessage.textContent = result.message;

  if (result.status === 'nodata') {
    bufferValue.textContent = '—';
    needValue.textContent = '—';
  } else if (result.status === 'danger') {
    bufferValue.textContent = '0 classes';
    needValue.textContent = result.need === null ? 'Not possible' : plural(result.need);
  } else {
    bufferValue.textContent = plural(result.buffer);
    needValue.textContent = '0 classes';
  }

  statusPill.classList.remove('safe', 'warning', 'danger');
  statusPill.classList.add(statusClass(result.status));
  statusPill.textContent = statusLabel(result.status);
}

/* ---------- subject cards (built once, then updated in place,
   so typing never loses focus) ---------- */

function buildCard(subject, index) {
  const card = document.createElement('article');
  card.className = 'subject-card';
  card.dataset.index = String(index);
  card.innerHTML = `
    <div class="subject-top">
      <h3 class="subject-name"></h3>
      <span class="subject-tag"></span>
    </div>
    <div class="subject-inputs">
      <div class="subject-field">
        <label>Held</label>
        <input type="number" min="0" step="1" data-field="total" value="${subject.total}" />
      </div>
      <div class="subject-field">
        <label>Attn.</label>
        <input type="number" min="0" step="1" data-field="attended" value="${subject.attended}" />
      </div>
      <div class="subject-field">
        <label>Req.</label>
        <input type="number" min="1" max="100" step="0.1" data-field="required" value="${subject.required}" />
      </div>
    </div>
    <p class="subject-error" role="alert"></p>
    <div class="subject-meta">
      <div class="subject-percent"></div>
      <div class="subject-note"></div>
    </div>
  `;
  return card;
}

function cardNote(result) {
  if (result.status === 'nodata') return 'No classes yet';
  if (result.status === 'danger') {
    return result.need === null ? 'Cannot recover' : `${plural(result.need)} to attend`;
  }
  if (result.buffer === 0) return 'At threshold';
  return `${plural(result.buffer)} buffer`;
}

function updateCard(index, errors = {}) {
  const card = subjectList.children[index];
  const s = state.subjects[index];
  if (!card || !s) return;

  const result = calculateAttendance(s.total, s.attended, s.required);
  const cls = statusClass(result.status);

  card.classList.remove('safe', 'warning', 'danger');
  card.classList.add(cls);
  card.classList.toggle('active', index === state.activeSubjectIndex);

  card.querySelector('.subject-name').textContent = s.name;       // textContent = no HTML injection
  const tag = card.querySelector('.subject-tag');
  tag.className = `subject-tag ${cls}`;
  tag.textContent = statusLabel(result.status);

  card.querySelector('.subject-percent').textContent = formatPercent(result.percentage);
  card.querySelector('.subject-note').textContent = cardNote(result);
  card.querySelector('.subject-error').textContent = firstError(errors);

  card.querySelectorAll('input[data-field]').forEach((input) => {
    input.classList.toggle('invalid', Boolean(errors[input.dataset.field]));
  });
}

function writeCardInputs(index, values) {
  const card = subjectList.children[index];
  if (!card) return;
  card.querySelectorAll('input[data-field]').forEach((input) => {
    input.value = values[input.dataset.field];
  });
}

function readCardInputs(card) {
  const raw = {};
  card.querySelectorAll('input[data-field]').forEach((input) => {
    raw[input.dataset.field] = input.value;
  });
  return raw;
}

function readMainInputs() {
  return {
    name: subjectNameInput.value,
    total: totalClassesInput.value,
    attended: attendedClassesInput.value,
    required: requiredPercentInput.value
  };
}

/* ---------- keeping everything in sync ---------- */

function setActive(index) {
  const s = state.subjects[index];
  if (!s) return;

  state.activeSubjectIndex = index;
  subjectNameInput.value = s.name;
  writeMainInputs(s);
  setMainErrors({});

  Array.from(subjectList.children).forEach((card, i) => {
    card.classList.toggle('active', i === index);
  });
  updateMain();
}

// Called on every keystroke. `raw` is exactly what the user typed.
function applyRaw(index, raw, source) {
  const { errors, values } = validateRaw(raw);
  const subject = state.subjects[index];
  Object.assign(subject, values);

  if (source === 'card') {
    if (state.activeSubjectIndex !== index) setActive(index);
    writeMainInputs(raw);                      // mirror what was typed, do not rewrite it
  } else {
    subject.name = (raw.name || '').trim().slice(0, 30) || 'Subject';
    writeCardInputs(index, raw);
  }

  setMainErrors(errors);
  updateCard(index, errors);
  updateMain();
}

// Called when the user leaves a field: replace odd values with the corrected ones.
function snapToValid(index) {
  const s = state.subjects[index];
  writeCardInputs(index, s);
  if (index === state.activeSubjectIndex) {
    writeMainInputs(s);
    setMainErrors({});
  }
  updateCard(index, {});
}

/* ---------- event handlers ---------- */

function attachSubjectHandlers() {
  subjectList.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const card = target.closest('.subject-card');
    if (!card) return;

    const index = Number(card.dataset.index);
    const raw = { ...readCardInputs(card), name: state.subjects[index].name };
    applyRaw(index, raw, 'card');
  });

  subjectList.addEventListener('change', (event) => {
    const card = event.target.closest('.subject-card');
    if (card) snapToValid(Number(card.dataset.index));
  });

  // Clicking or tabbing into a card makes it the one shown in the main panel.
  const activateFromEvent = (event) => {
    const card = event.target.closest('.subject-card');
    if (!card) return;
    const index = Number(card.dataset.index);
    if (index !== state.activeSubjectIndex) setActive(index);
  };
  subjectList.addEventListener('focusin', activateFromEvent);
  subjectList.addEventListener('click', activateFromEvent);
}

function attachMainHandlers() {
  [subjectNameInput, totalClassesInput, attendedClassesInput, requiredPercentInput].forEach((input) => {
    input.addEventListener('input', () => {
      applyRaw(state.activeSubjectIndex, readMainInputs(), 'main');
    });
    input.addEventListener('change', () => snapToValid(state.activeSubjectIndex));
  });
}

function addSubject() {
  const subject = normalizeSubject({
    name: `Subject ${state.subjects.length + 1}`,
    total: 30,
    attended: 20,
    required: 75
  });

  state.subjects.push(subject);
  const index = state.subjects.length - 1;
  subjectList.appendChild(buildCard(subject, index));
  updateCard(index);
  setActive(index);
}

/* ---------- start ---------- */

function init() {
  state.subjects.forEach((subject, index) => {
    subjectList.appendChild(buildCard(subject, index));
    updateCard(index);
  });

  document.getElementById('addSubjectBtn').addEventListener('click', addSubject);
  themeButtons.forEach((button) => {
    button.addEventListener('click', () => applyTheme(button.dataset.theme));
  });

  initializeTheme();
  attachSubjectHandlers();
  attachMainHandlers();
  setActive(0);
}

init();