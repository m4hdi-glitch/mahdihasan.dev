/* =========================================================================
   SCHOOL RESULT PORTAL  –  app.js
   Plain JS + Supabase. No build step. Open index.html in a browser.

   SCHEMA ADDITIONS vs original:
   ─────────────────────────────
   -- sections inside a grade  (Grade 1 → A, B, C …)
   create table sections (
     id serial primary key,
     grade_id int references grades(id) on delete cascade,
     name text not null          -- 'A', 'B', 'C' …
   );

   -- link students to a section (grade is still set on students for quick lookup)
   alter table students add column section_id int references sections(id);

   -- form-teacher assignment: one teacher is "form teacher" for a section
   create table form_teachers (
     teacher_id uuid references profiles(id) on delete cascade,
     section_id int  references sections(id)  on delete cascade,
     primary key (teacher_id, section_id)
   );

   -- teacher_subjects: add optional grade_id so the same subject taught in
   --   different grades can be assigned separately
   alter table teacher_subjects add column grade_id int references grades(id);

   Everything else (grades, subjects, students, marks, teacher_comments,
   grade_subjects, school_settings) is unchanged from the original schema.
   ========================================================================= */

const SUPABASE_URL      = 'https://vhferhuwbtfqekeyymow.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZoZmVyaHV3YnRmcWVrZXl5bW93Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4NzgxNDcsImV4cCI6MjA5ODQ1NDE0N30.8RYwVnsc2mtncJ3_4eES_u-_0hXgsbQC3t5qttT_JBM';

let db             = null;
let currentUser    = null;
let currentProfile = null;
let schoolSettings = {};

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────
function initSupabase() {
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    showConfigError('The Supabase library failed to load from the CDN. Check your internet connection and reload.');
    return false;
  }
  try {
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return true;
  } catch (e) {
    showConfigError('Could not connect: ' + e.message);
    return false;
  }
}
function showConfigError(msg) {
  document.getElementById('config-screen').classList.remove('hidden');
  const el = document.getElementById('config-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

window.addEventListener('DOMContentLoaded', boot);

async function boot() {
  if (!initSupabase()) return;
  await loadSchoolSettings();
  applyBranding();
  const { data: { session } } = await db.auth.getSession();
  if (session?.user) { currentUser = session.user; await loadProfileAndEnter(); }
  else showLogin();
  db.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') { currentUser = null; currentProfile = null; showLogin(); }
  });
}

async function loadSchoolSettings() {
  schoolSettings = {};
  try {
    const { data } = await db.from('school_settings').select('key,value');
    (data || []).forEach(r => { schoolSettings[r.key] = r.value; });
  } catch {}
}

function applyBranding() {
  const name = schoolSettings.school_name || 'School Result Portal';
  const logo = schoolSettings.logo_url || fallbackLogoDataUri();
  document.title = name;
  ['login-school-name','header-school-name'].forEach(id => { const e = document.getElementById(id); if (e) e.textContent = name; });
  ['login-logo','header-logo'].forEach(id => { const e = document.getElementById(id); if (e) e.src = logo; });
}

function fallbackLogoDataUri() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#e5e7eb"/><text x="40" y="50" font-size="34" text-anchor="middle" fill="#888" font-family="Arial">S</text></svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────────
function showLogin() {
  document.getElementById('config-screen').classList.add('hidden');
  document.getElementById('login-wrap').classList.remove('hidden');
  document.getElementById('app-wrap').classList.add('hidden');
}

async function doLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  errEl.classList.add('hidden');
  if (!email || !password) { errEl.textContent = 'Enter your email and password.'; errEl.classList.remove('hidden'); return; }
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) { errEl.textContent = error.message; errEl.classList.remove('hidden'); return; }
  currentUser = data.user;
  await loadProfileAndEnter();
}

async function doLogout() { await db.auth.signOut(); }

async function loadProfileAndEnter() {
  const { data, error } = await db.from('profiles').select('id,name,role').eq('id', currentUser.id).single();
  if (error || !data) {
    document.getElementById('login-error').textContent = 'Logged in but no profile found. Ask the admin to add you.';
    document.getElementById('login-error').classList.remove('hidden');
    document.getElementById('login-wrap').classList.remove('hidden');
    document.getElementById('app-wrap').classList.add('hidden');
    return;
  }
  currentProfile = data;
  enterApp();
}

function enterApp() {
  document.getElementById('config-screen').classList.add('hidden');
  document.getElementById('login-wrap').classList.add('hidden');
  document.getElementById('app-wrap').classList.remove('hidden');
  document.getElementById('header-user-name').textContent = currentProfile.name + ' (' + currentProfile.role + ')';
  if (currentProfile.role === 'admin') {
    document.getElementById('admin-panel').classList.remove('hidden');
    document.getElementById('teacher-panel').classList.add('hidden');
    renderAdminPanel();
  } else {
    document.getElementById('teacher-panel').classList.remove('hidden');
    document.getElementById('admin-panel').classList.add('hidden');
    renderTeacherPanel();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function showStatus(msg, isError) {
  const area = document.getElementById('status-area');
  const div  = document.createElement('div');
  div.className   = 'status-msg ' + (isError ? 'err' : 'ok');
  div.textContent = msg;
  area.innerHTML  = '';
  area.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}

function el(tag, attrs, children) {
  const e = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach(k => {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'html')  e.innerHTML = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  });
  (children || []).forEach(c => {
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else if (c) e.appendChild(c);
  });
  return e;
}

function field(label, id, type, placeholder) {
  return el('div', { class: 'form-field' }, [
    el('label', { for: id }, [label]),
    el('input', { id, type, placeholder: placeholder || '' }),
  ]);
}
function selectField(label, id, options) {
  return el('div', { class: 'form-field' }, [
    el('label', { for: id }, [label]),
    el('select', { id }, options),
  ]);
}

function letterGrade(mark) {
  const m = Number(mark);
  if (isNaN(m)) return '-';
  if (m >= 80) return 'A+';
  if (m >= 70) return 'A';
  if (m >= 60) return 'A-';
  if (m >= 50) return 'B';
  if (m >= 40) return 'C';
  if (m >= 33) return 'D';
  return 'F';
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}


/* =============================================================================
   ADMIN PANEL
   Tabs: Students | Teachers | Grades & Subjects | Marks Overview | PDFs | Settings
   ============================================================================= */

let adminTab   = 'students';
let adminCache = {
  grades: [], sections: [], subjects: [], students: [],
  teachers: [], gradeSubjects: [], teacherSubjects: [], formTeachers: []
};

async function renderAdminPanel() {
  const root = document.getElementById('admin-panel');
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'tabs' }, [
    tabBtn('students', '👩‍🎓 Students'),
    tabBtn('teachers', '👩‍🏫 Teachers'),
    tabBtn('subjects',  '📚 Grades & Subjects'),
    tabBtn('marks',     '📝 Marks Overview'),
    tabBtn('pdfs',      '🖨 Report Cards'),
    tabBtn('settings',  '⚙️ Settings'),
  ]));
  root.appendChild(el('div', { id: 'admin-tab-body' }));
  await loadAdminCache();
  renderAdminTabBody();
}

function tabBtn(key, label) {
  return el('button', {
    class: 'tab-btn' + (adminTab === key ? ' active' : ''),
    onclick: () => { adminTab = key; renderAdminPanel(); }
  }, [label]);
}

async function loadAdminCache() {
  const [g, sec, s, st, tp, gs, ts, ft] = await Promise.all([
    db.from('grades').select('*').order('name'),
    db.from('sections').select('*').order('name').catch(() => ({ data: [] })),
    db.from('subjects').select('*').order('name'),
    db.from('students').select('*').order('name'),
    db.from('profiles').select('*').eq('role','teacher').order('name'),
    db.from('grade_subjects').select('*'),
    db.from('teacher_subjects').select('*'),
    db.from('form_teachers').select('*').catch(() => ({ data: [] })),
  ]);
  adminCache.grades         = g.data   || [];
  adminCache.sections       = (sec.data || []);
  adminCache.subjects       = s.data   || [];
  adminCache.students       = st.data  || [];
  adminCache.teachers       = tp.data  || [];
  adminCache.gradeSubjects  = gs.data  || [];
  adminCache.teacherSubjects= ts.data  || [];
  adminCache.formTeachers   = ft.data  || [];
}

function renderAdminTabBody() {
  const body = document.getElementById('admin-tab-body');
  body.innerHTML = '';
  if (adminTab === 'students') return renderStudentsTab(body);
  if (adminTab === 'teachers') return renderTeachersTab(body);
  if (adminTab === 'subjects') return renderGradesSubjectsTab(body);
  if (adminTab === 'marks')    return renderMarksOverviewTab(body);
  if (adminTab === 'pdfs')     return renderPdfTab(body);
  if (adminTab === 'settings') return renderSettingsTab(body);
}

/* ─── Students Tab ────────────────────────────────────────────────────────── */
function renderStudentsTab(body) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', {}, ['Students']));

  // Add student form
  const gradeOpts = adminCache.grades.map(g => el('option', { value: g.id }, [g.name]));
  const sectionOpts = [el('option', { value: '' }, ['— No section —']),
    ...adminCache.sections.map(s => {
      const g = adminCache.grades.find(x => x.id === s.grade_id);
      return el('option', { value: s.id }, [(g ? g.name + ' ' : '') + 'Section ' + s.name]);
    })
  ];
  card.appendChild(el('div', { class: 'form-row' }, [
    field('Student Code', 'new-stu-code', 'text', 'e.g. G1A-001'),
    field('Full Name',    'new-stu-name', 'text', 'Full name'),
    selectField('Grade',   'new-stu-grade',   gradeOpts),
    selectField('Section', 'new-stu-section', sectionOpts),
    el('button', { class: 'btn', onclick: addStudent }, ['Add Student']),
  ]));

  // Students grouped by Grade → Section
  adminCache.grades.forEach(grade => {
    const gradeStudents = adminCache.students.filter(s => s.grade_id === grade.id);
    if (!gradeStudents.length) return;

    const gradeHeader = el('div', { class: 'grade-group-header' }, [grade.name]);
    card.appendChild(gradeHeader);

    // Group by section
    const gradeSections = adminCache.sections.filter(s => s.grade_id === grade.id);

    if (gradeSections.length) {
      gradeSections.forEach(section => {
        const secStudents = gradeStudents.filter(s => s.section_id === section.id);
        if (!secStudents.length) return;
        card.appendChild(el('div', { class: 'section-label' }, ['Section ' + section.name]));
        card.appendChild(buildStudentTable(secStudents, grade));
      });
      // Students with no section assigned
      const noSection = gradeStudents.filter(s => !s.section_id);
      if (noSection.length) {
        card.appendChild(el('div', { class: 'section-label muted' }, ['No Section Assigned']));
        card.appendChild(buildStudentTable(noSection, grade));
      }
    } else {
      card.appendChild(buildStudentTable(gradeStudents, grade));
    }
  });

  // Students with no grade
  const noGrade = adminCache.students.filter(s => !s.grade_id);
  if (noGrade.length) {
    card.appendChild(el('div', { class: 'grade-group-header' }, ['No Grade Assigned']));
    card.appendChild(buildStudentTable(noGrade, null));
  }

  body.appendChild(card);
}

function buildStudentTable(students, grade) {
  const wrap  = el('div', { class: 'table-wrap', style: 'margin-bottom:12px;' });
  const table = el('table');
  table.appendChild(el('tr', {}, [
    el('th', {}, ['Code']), el('th', {}, ['Name']),
    el('th', {}, ['Grade']), el('th', {}, ['Section']), el('th', {}, [''])
  ]));
  students.forEach(s => {
    const sec = adminCache.sections.find(x => x.id === s.section_id);
    table.appendChild(el('tr', {}, [
      el('td', {}, [s.student_code]),
      el('td', {}, [s.name]),
      el('td', {}, [grade ? grade.name : '-']),
      el('td', {}, [sec ? 'Section ' + sec.name : '-']),
      el('td', {}, [el('button', { class: 'btn danger', onclick: () => deleteStudent(s.id) }, ['Delete'])]),
    ]));
  });
  wrap.appendChild(table);
  return wrap;
}

async function addStudent() {
  const code    = document.getElementById('new-stu-code').value.trim();
  const name    = document.getElementById('new-stu-name').value.trim();
  const gradeId = document.getElementById('new-stu-grade').value;
  const secId   = document.getElementById('new-stu-section').value;
  if (!code || !name || !gradeId) { showStatus('Fill in code, name and grade.', true); return; }
  const row = { student_code: code, name, grade_id: Number(gradeId) };
  if (secId) row.section_id = Number(secId);
  const { error } = await db.from('students').insert(row);
  if (error) { showStatus(error.message, true); return; }
  showStatus('Student added.');
  await loadAdminCache(); renderAdminTabBody();
}

async function deleteStudent(id) {
  if (!confirm('Delete this student? Their marks and comments will also be deleted.')) return;
  await db.from('marks').delete().eq('student_id', id);
  await db.from('teacher_comments').delete().eq('student_id', id);
  const { error } = await db.from('students').delete().eq('id', id);
  if (error) { showStatus(error.message, true); return; }
  showStatus('Student deleted.');
  await loadAdminCache(); renderAdminTabBody();
}

/* ─── Teachers Tab ────────────────────────────────────────────────────────── */
function renderTeachersTab(body) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', {}, ['Teachers']));
  card.appendChild(el('p', { class: 'muted small' }, [
    'Create the teacher account in Supabase Auth first, then paste their UUID here.'
  ]));

  card.appendChild(el('div', { class: 'form-row' }, [
    field('Supabase User ID', 'new-teacher-uid',  'text', 'uuid from Supabase Auth'),
    field('Full Name',        'new-teacher-name', 'text', 'Full name'),
    el('button', { class: 'btn', onclick: addTeacherProfile }, ['Add Teacher']),
  ]));

  const wrap  = el('div', { class: 'table-wrap' });
  const table = el('table');
  table.appendChild(el('tr', {}, [
    el('th', {}, ['Name']),
    el('th', {}, ['Assigned Subjects (Grade – Subject)']),
    el('th', {}, ['Form Teacher Of']),
    el('th', {}, ['Assign Subject']),
    el('th', {}, ['Assign as Form Teacher']),
    el('th', {}, ['Actions']),
  ]));

  adminCache.teachers.forEach(t => {
    const myTS = adminCache.teacherSubjects.filter(ts => ts.teacher_id === t.id);

    // Subject badges: "Grade 1 – Math"
    const subjectBadges = myTS.map(ts => {
      const subj  = adminCache.subjects.find(x => x.id === ts.subject_id);
      const grade = ts.grade_id ? adminCache.grades.find(x => x.id === ts.grade_id) : null;
      const label = (grade ? grade.name + ' – ' : '') + (subj ? subj.name : '?');
      return el('span', { class: 'badge', style: 'margin:2px;display:inline-flex;align-items:center;gap:4px;' }, [
        label,
        el('button', {
          style: 'background:none;border:none;color:#c1121f;cursor:pointer;font-size:13px;padding:0 2px;',
          title: 'Remove this subject assignment',
          onclick: () => removeTeacherSubject(ts.teacher_id, ts.subject_id, ts.grade_id)
        }, ['✕'])
      ]);
    });

    const subjTd = el('td', {}, subjectBadges.length
      ? subjectBadges
      : [el('span', { class: 'muted small' }, ['None'])]);

    // Form teacher section badges
    const myFT = adminCache.formTeachers.filter(ft => ft.teacher_id === t.id);
    const ftBadges = myFT.map(ft => {
      const sec   = adminCache.sections.find(x => x.id === ft.section_id);
      const grade = sec ? adminCache.grades.find(x => x.id === sec.grade_id) : null;
      const label = grade ? grade.name + ' Sec ' + sec.name : '?';
      return el('span', { class: 'badge badge-green', style: 'margin:2px;display:inline-flex;align-items:center;gap:4px;' }, [
        label,
        el('button', {
          style: 'background:none;border:none;color:#065f46;cursor:pointer;font-size:13px;padding:0 2px;',
          onclick: () => removeFormTeacher(t.id, ft.section_id)
        }, ['✕'])
      ]);
    });
    const ftTd = el('td', {}, ftBadges.length ? ftBadges : [el('span', { class: 'muted small' }, ['—'])]);

    // Assign subject cell: Grade + Subject dropdowns
    const assignGradeOpts = adminCache.grades.map(g => el('option', { value: g.id }, [g.name]));
    const assignGradeSel  = el('select', { id: 'asg-grade-' + t.id, style: 'margin-right:4px;' }, assignGradeOpts);

    const assignSubjOpts  = adminCache.subjects.map(s => el('option', { value: s.id }, [s.name]));
    const assignSubjSel   = el('select', { id: 'asg-subj-' + t.id, style: 'margin-right:4px;' }, assignSubjOpts);

    const assignBtn = el('button', { class: 'btn secondary', style: 'white-space:nowrap;',
      onclick: () => assignSubjectToTeacher(t.id,
        document.getElementById('asg-grade-' + t.id).value,
        document.getElementById('asg-subj-'  + t.id).value)
    }, ['Assign']);
    const assignCell = el('td', {}, [assignGradeSel, assignSubjSel, assignBtn]);

    // Assign form-teacher cell
    const ftSectionOpts  = adminCache.sections.map(s => {
      const g = adminCache.grades.find(x => x.id === s.grade_id);
      return el('option', { value: s.id }, [(g ? g.name + ' – ' : '') + 'Section ' + s.name]);
    });
    const ftSectionSel  = el('select', { id: 'ft-sec-' + t.id }, ftSectionOpts);
    const ftAssignBtn   = el('button', { class: 'btn secondary',
      onclick: () => assignFormTeacher(t.id, document.getElementById('ft-sec-' + t.id).value)
    }, ['Set']);
    const ftAssignCell  = el('td', {}, ftSectionOpts.length
      ? [ftSectionSel, ftAssignBtn]
      : [el('span', { class: 'muted small' }, ['No sections yet'])]);

    table.appendChild(el('tr', {}, [
      el('td', {}, [t.name]),
      subjTd,
      ftTd,
      assignCell,
      ftAssignCell,
      el('td', {}, [el('button', { class: 'btn danger', onclick: () => removeTeacher(t.id) }, ['Remove'])]),
    ]));
  });

  wrap.appendChild(table);
  card.appendChild(wrap);
  body.appendChild(card);
}

async function addTeacherProfile() {
  const uid  = document.getElementById('new-teacher-uid').value.trim();
  const name = document.getElementById('new-teacher-name').value.trim();
  if (!uid || !name) { showStatus('Fill in both fields.', true); return; }
  const { error } = await db.from('profiles').insert({ id: uid, name, role: 'teacher' });
  if (error) { showStatus(error.message, true); return; }
  showStatus('Teacher added.');
  await loadAdminCache(); renderAdminTabBody();
}

async function assignSubjectToTeacher(teacherId, gradeId, subjectId) {
  if (!gradeId || !subjectId) return;
  const row = { teacher_id: teacherId, subject_id: Number(subjectId), grade_id: Number(gradeId) };
  // Check duplicate
  const existing = adminCache.teacherSubjects.find(
    ts => ts.teacher_id === teacherId && ts.subject_id === Number(subjectId) && ts.grade_id === Number(gradeId)
  );
  if (existing) { showStatus('Already assigned.', true); return; }
  const { error } = await db.from('teacher_subjects').insert(row);
  if (error) { showStatus(error.message, true); return; }
  showStatus('Subject assigned.');
  await loadAdminCache(); renderAdminTabBody();
}

async function removeTeacherSubject(teacherId, subjectId, gradeId) {
  let q = db.from('teacher_subjects').delete().eq('teacher_id', teacherId).eq('subject_id', subjectId);
  if (gradeId) q = q.eq('grade_id', gradeId);
  const { error } = await q;
  if (error) { showStatus(error.message, true); return; }
  showStatus('Subject assignment removed.');
  await loadAdminCache(); renderAdminTabBody();
}

async function assignFormTeacher(teacherId, sectionId) {
  if (!sectionId) return;
  const { error } = await db.from('form_teachers').upsert(
    { teacher_id: teacherId, section_id: Number(sectionId) },
    { onConflict: 'teacher_id,section_id' }
  );
  if (error) { showStatus(error.message, true); return; }
  showStatus('Form teacher assigned.');
  await loadAdminCache(); renderAdminTabBody();
}

async function removeFormTeacher(teacherId, sectionId) {
  const { error } = await db.from('form_teachers').delete()
    .eq('teacher_id', teacherId).eq('section_id', sectionId);
  if (error) { showStatus(error.message, true); return; }
  showStatus('Form teacher removed.');
  await loadAdminCache(); renderAdminTabBody();
}

async function removeTeacher(id) {
  if (!confirm('Remove this teacher profile? Their Supabase Auth login is not deleted.')) return;
  await db.from('teacher_subjects').delete().eq('teacher_id', id);
  await db.from('form_teachers').delete().eq('teacher_id', id).catch(() => {});
  const { error } = await db.from('profiles').delete().eq('id', id);
  if (error) { showStatus(error.message, true); return; }
  showStatus('Teacher removed.');
  await loadAdminCache(); renderAdminTabBody();
}

/* ─── Grades & Subjects Tab ──────────────────────────────────────────────── */
function renderGradesSubjectsTab(body) {

  /* ── GRADES ── */
  const gCard = el('div', { class: 'card' });
  gCard.appendChild(el('h2', {}, ['Grades']));
  gCard.appendChild(el('div', { class: 'form-row' }, [
    field('Grade name', 'new-grade-name', 'text', 'e.g. Grade 1'),
    el('button', { class: 'btn', onclick: addGrade }, ['Add Grade']),
  ]));
  const gTable = el('table');
  gTable.appendChild(el('tr', {}, [el('th', {}, ['Grade']), el('th', {}, ['Sections']), el('th', {}, ['Add Section']), el('th', {}, [''])]));
  adminCache.grades.forEach(g => {
    const secs    = adminCache.sections.filter(s => s.grade_id === g.id);
    const secBadges = secs.map(s => el('span', { class: 'badge', style: 'margin:2px;display:inline-flex;gap:4px;align-items:center;' }, [
      'Section ' + s.name,
      el('button', {
        style: 'background:none;border:none;color:#c1121f;cursor:pointer;font-size:12px;padding:0 2px;',
        onclick: () => deleteSection(s.id)
      }, ['✕'])
    ]));
    const secNameInput = el('input', { id: 'new-sec-' + g.id, type: 'text', placeholder: 'A', style: 'width:60px;margin-right:6px;' });
    const secAddBtn    = el('button', { class: 'btn secondary',
      onclick: () => addSection(g.id, document.getElementById('new-sec-' + g.id).value)
    }, ['Add']);
    gTable.appendChild(el('tr', {}, [
      el('td', {}, [g.name]),
      el('td', {}, secBadges.length ? secBadges : [el('span', { class: 'muted small' }, ['None'])]),
      el('td', {}, [secNameInput, secAddBtn]),
      el('td', {}, [el('button', { class: 'btn danger', onclick: () => deleteGrade(g.id) }, ['Delete'])]),
    ]));
  });
  gCard.appendChild(el('div', { class: 'table-wrap' }, [gTable]));
  body.appendChild(gCard);

  /* ── SUBJECTS ── */
  const sCard = el('div', { class: 'card' });
  sCard.appendChild(el('h2', {}, ['Subjects']));
  sCard.appendChild(el('div', { class: 'form-row' }, [
    field('Subject name', 'new-subject-name', 'text', 'e.g. Mathematics'),
    el('button', { class: 'btn', onclick: addSubject }, ['Add Subject']),
  ]));
  const sTable = el('table');
  sTable.appendChild(el('tr', {}, [el('th', {}, ['Subject']), el('th', {}, ['Used in Grades']), el('th', {}, [''])]));
  adminCache.subjects.forEach(s => {
    const usedGrades = adminCache.gradeSubjects
      .filter(gs => gs.subject_id === s.id)
      .map(gs => { const g = adminCache.grades.find(x => x.id === gs.grade_id); return g ? g.name : '?'; });
    sTable.appendChild(el('tr', {}, [
      el('td', {}, [s.name]),
      el('td', {}, [usedGrades.length
        ? usedGrades.map(n => el('span', { class: 'badge', style: 'margin:2px;' }, [n]))
        : [el('span', { class: 'muted small' }, ['Not assigned to any grade'])]
      ]),
      el('td', {}, [el('button', { class: 'btn danger', onclick: () => deleteSubject(s.id) }, ['Delete'])]),
    ]));
  });
  sCard.appendChild(el('div', { class: 'table-wrap' }, [sTable]));
  body.appendChild(sCard);

  /* ── SUBJECT MAPPING (Grades → Subjects) ── */
  const gsCard = el('div', { class: 'card' });
  gsCard.appendChild(el('h2', {}, ['Subject Mapping — Which Subjects Belong to Which Grade']));
  gsCard.appendChild(el('p', { class: 'muted small' }, ['Add or remove subjects per grade. Marks can only be entered for mapped subjects.']));

  // Add mapping form
  const gradeOpts = adminCache.grades.map(g => el('option', { value: g.id }, [g.name]));
  const subjOpts  = adminCache.subjects.map(s => el('option', { value: s.id }, [s.name]));
  gsCard.appendChild(el('div', { class: 'form-row' }, [
    selectField('Grade',   'gs-grade',   gradeOpts),
    selectField('Subject', 'gs-subject', subjOpts),
    el('button', { class: 'btn', onclick: addGradeSubject }, ['Add Mapping']),
  ]));

  // Mapping organized BY GRADE
  adminCache.grades.forEach(g => {
    const mappedSubjectIds = adminCache.gradeSubjects.filter(gs => gs.grade_id === g.id).map(gs => gs.subject_id);
    const mappedSubjects   = adminCache.subjects.filter(s => mappedSubjectIds.includes(s.id));
    if (!mappedSubjects.length) return;

    gsCard.appendChild(el('div', { class: 'grade-group-header', style: 'margin-top:14px;' }, [g.name]));
    const badges = mappedSubjects.map(s => el('span', {
      class: 'badge', style: 'margin:4px;display:inline-flex;align-items:center;gap:6px;font-size:13px;padding:4px 10px;'
    }, [
      s.name,
      el('button', {
        style: 'background:none;border:none;color:#c1121f;cursor:pointer;font-size:13px;line-height:1;',
        title: 'Remove ' + s.name + ' from ' + g.name,
        onclick: () => deleteGradeSubject(g.id, s.id)
      }, ['✕'])
    ]));
    const badgeWrap = el('div', { style: 'display:flex;flex-wrap:wrap;padding:6px 0;' }, badges);
    gsCard.appendChild(badgeWrap);
  });

  body.appendChild(gsCard);
}

async function addGrade() {
  const name = document.getElementById('new-grade-name').value.trim();
  if (!name) return;
  const { error } = await db.from('grades').insert({ name });
  if (error) { showStatus(error.message, true); return; }
  showStatus('Grade added.');
  await loadAdminCache(); renderAdminTabBody();
}
async function deleteGrade(id) {
  if (!confirm('Delete this grade? Students will lose their grade assignment.')) return;
  const { error } = await db.from('grades').delete().eq('id', id);
  if (error) { showStatus(error.message, true); return; }
  showStatus('Grade deleted.');
  await loadAdminCache(); renderAdminTabBody();
}
async function addSection(gradeId, name) {
  name = (name || '').trim().toUpperCase();
  if (!name || !gradeId) { showStatus('Enter a section name.', true); return; }
  const { error } = await db.from('sections').insert({ grade_id: Number(gradeId), name });
  if (error) { showStatus(error.message, true); return; }
  showStatus('Section added.');
  await loadAdminCache(); renderAdminTabBody();
}
async function deleteSection(id) {
  if (!confirm('Delete this section?')) return;
  const { error } = await db.from('sections').delete().eq('id', id);
  if (error) { showStatus(error.message, true); return; }
  showStatus('Section deleted.');
  await loadAdminCache(); renderAdminTabBody();
}
async function addSubject() {
  const name = document.getElementById('new-subject-name').value.trim();
  if (!name) return;
  const { error } = await db.from('subjects').insert({ name });
  if (error) { showStatus(error.message, true); return; }
  showStatus('Subject added.');
  await loadAdminCache(); renderAdminTabBody();
}
async function deleteSubject(id) {
  if (!confirm('Delete this subject? All marks and grade mappings for it will be removed.')) return;
  // Remove dependents first to avoid FK violations
  await db.from('marks').delete().eq('subject_id', id);
  await db.from('grade_subjects').delete().eq('subject_id', id);
  await db.from('teacher_subjects').delete().eq('subject_id', id);
  const { error } = await db.from('subjects').delete().eq('id', id);
  if (error) { showStatus('Could not delete: ' + error.message, true); return; }
  showStatus('Subject deleted.');
  await loadAdminCache(); renderAdminTabBody();
}
async function addGradeSubject() {
  const gradeId   = document.getElementById('gs-grade').value;
  const subjectId = document.getElementById('gs-subject').value;
  if (!gradeId || !subjectId) return;
  const { error } = await db.from('grade_subjects').insert({ grade_id: Number(gradeId), subject_id: Number(subjectId) });
  if (error) { showStatus(error.message, true); return; }
  showStatus('Mapping added.');
  await loadAdminCache(); renderAdminTabBody();
}
async function deleteGradeSubject(gradeId, subjectId) {
  const { error } = await db.from('grade_subjects').delete().eq('grade_id', gradeId).eq('subject_id', subjectId);
  if (error) { showStatus(error.message, true); return; }
  showStatus('Mapping removed.');
  await loadAdminCache(); renderAdminTabBody();
}

/* ─── Marks Overview Tab ─────────────────────────────────────────────────── */
async function renderMarksOverviewTab(body) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', {}, ['Marks Overview']));

  // Grade buttons
  const btnRow = el('div', { class: 'btn-row', style: 'flex-wrap:wrap;margin-bottom:12px;' });
  adminCache.grades.forEach((g, i) => {
    const btn = el('button', {
      class: 'btn secondary grade-filter-btn',
      id: 'mgb-' + g.id,
      onclick: () => {
        document.querySelectorAll('.grade-filter-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('mgb-' + g.id).classList.add('active');
        document.getElementById('marks-grade-id').value = g.id;
        loadAndRenderMarksGrid();
      }
    }, [g.name]);
    if (i === 0) btn.classList.add('active');
    btnRow.appendChild(btn);
  });
  card.appendChild(btnRow);

  const hiddenInput = el('input', { type: 'hidden', id: 'marks-grade-id', value: adminCache.grades[0]?.id || '' });
  card.appendChild(hiddenInput);

  const gridWrap = el('div', { id: 'marks-grid-wrap' });
  card.appendChild(gridWrap);
  body.appendChild(card);

  if (adminCache.grades.length) await loadAndRenderMarksGrid();
}

async function loadAndRenderMarksGrid() {
  const gradeId  = Number(document.getElementById('marks-grade-id').value);
  const gridWrap = document.getElementById('marks-grid-wrap');
  gridWrap.innerHTML = '<p class="muted">Loading…</p>';

  const students   = adminCache.students.filter(s => s.grade_id === gradeId);
  const subjectIds = adminCache.gradeSubjects.filter(gs => gs.grade_id === gradeId).map(gs => gs.subject_id);
  const subjects   = adminCache.subjects.filter(s => subjectIds.includes(s.id));

  if (!students.length || !subjects.length) {
    gridWrap.innerHTML = '<p class="muted">No students or subjects set up for this grade yet.</p>';
    return;
  }

  const { data: marksData } = await db.from('marks').select('*').in('student_id', students.map(s => s.id));
  const marksMap = {};
  (marksData || []).forEach(m => { marksMap[m.student_id + '-' + m.subject_id] = m.mark; });

  gridWrap.innerHTML = '';

  // Group students by section
  const gradeSections  = adminCache.sections.filter(s => s.grade_id === gradeId);
  const renderGroup    = (groupStudents) => {
    if (!groupStudents.length) return;
    const table = el('table');
    table.appendChild(el('tr', {}, [
      el('th', {}, ['Student']),
      ...subjects.map(s => el('th', {}, [s.name]))
    ]));
    groupStudents.forEach(stu => {
      const row = el('tr', {}, [el('td', {}, [stu.name + ' (' + stu.student_code + ')'])]);
      subjects.forEach(subj => {
        const key   = stu.id + '-' + subj.id;
        const input = el('input', { type: 'number', min: '0', max: '100',
          value: marksMap[key] != null ? marksMap[key] : '', id: 'am-' + key });
        row.appendChild(el('td', {}, [input]));
      });
      table.appendChild(row);
    });
    gridWrap.appendChild(el('div', { class: 'table-wrap', style: 'margin-bottom:8px;' }, [table]));
  };

  if (gradeSections.length) {
    gradeSections.forEach(sec => {
      const secStudents = students.filter(s => s.section_id === sec.id);
      if (!secStudents.length) return;
      gridWrap.appendChild(el('div', { class: 'section-label' }, ['Section ' + sec.name]));
      renderGroup(secStudents);
    });
    const noSec = students.filter(s => !s.section_id);
    if (noSec.length) { gridWrap.appendChild(el('div', { class: 'section-label muted' }, ['No Section'])); renderGroup(noSec); }
  } else {
    renderGroup(students);
  }

  gridWrap.appendChild(el('button', {
    class: 'btn', style: 'margin-top:10px;',
    onclick: () => saveMarksGrid(students, subjects)
  }, ['💾 Save All Marks']));
}

async function saveMarksGrid(students, subjects) {
  const rows = [];
  students.forEach(stu => {
    subjects.forEach(subj => {
      const key = stu.id + '-' + subj.id;
      const inp = document.getElementById('am-' + key);
      if (inp && inp.value !== '') rows.push({ student_id: stu.id, subject_id: subj.id, mark: Number(inp.value) });
    });
  });
  if (!rows.length) { showStatus('No marks entered.', true); return; }
  const { error } = await db.from('marks').upsert(rows, { onConflict: 'student_id,subject_id' });
  if (error) { showStatus(error.message, true); return; }
  showStatus('Marks saved.');
}

/* ─── Settings Tab ───────────────────────────────────────────────────────── */
function renderSettingsTab(body) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', {}, ['School Settings']));
  [
    { key: 'school_name',    label: 'School name' },
    { key: 'logo_url',       label: 'Logo URL' },
    { key: 'principal_name', label: 'Principal name' },
    { key: 'report_footer',  label: 'Report card footer text' },
    { key: 'signature_url',  label: 'Signature image URL' },
  ].forEach(k => {
    card.appendChild(el('div', { class: 'form-row' }, [
      el('div', { class: 'form-field', style: 'flex:1;min-width:280px;' }, [
        el('label', {}, [k.label]),
        el('input', { id: 'setting-' + k.key, type: 'text', value: schoolSettings[k.key] || '' }),
      ]),
    ]));
  });
  card.appendChild(el('button', { class: 'btn', onclick: saveSettings }, ['Save Settings']));
  card.appendChild(el('p', { class: 'muted small', style: 'margin-top:16px;' }, ['Supabase: ' + SUPABASE_URL]));
  body.appendChild(card);
}

async function saveSettings() {
  const keys = ['school_name','logo_url','principal_name','report_footer','signature_url'];
  const rows = keys.map(k => ({ key: k, value: document.getElementById('setting-' + k).value }));
  const { error } = await db.from('school_settings').upsert(rows, { onConflict: 'key' });
  if (error) { showStatus(error.message, true); return; }
  showStatus('Settings saved.');
  await loadSchoolSettings(); applyBranding();
}


/* =============================================================================
   PDF GENERATION
   ============================================================================= */
function renderPdfTab(body) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', {}, ['Report Cards & Marksheets']));

  // Single student
  const single = el('div', { style: 'margin-bottom:20px;' });
  single.appendChild(el('h3', {}, ['Single Student Report Card']));
  const studentOpts  = adminCache.students.map(s => {
    const g = adminCache.grades.find(gr => gr.id === s.grade_id);
    return el('option', { value: s.id }, [s.name + ' (' + s.student_code + (g ? ', ' + g.name : '') + ')']);
  });
  single.appendChild(el('div', { class: 'form-row' }, [
    el('div', { class: 'form-field' }, [el('label', {}, ['Student']), el('select', { id: 'pdf-student-select' }, studentOpts)]),
    el('button', { class: 'btn', onclick: generateSingleReportCard }, ['Generate PDF']),
  ]));
  card.appendChild(single);

  // Whole grade
  const bulk = el('div', { style: 'border-top:1px solid #eee;padding-top:16px;margin-bottom:20px;' });
  bulk.appendChild(el('h3', {}, ['All Report Cards for a Grade']));
  const gradeOpts = adminCache.grades.map(g => el('option', { value: g.id }, [g.name]));
  bulk.appendChild(el('div', { class: 'form-row' }, [
    el('div', { class: 'form-field' }, [el('label', {}, ['Grade']), el('select', { id: 'pdf-grade-select' }, gradeOpts)]),
    el('button', { class: 'btn', onclick: generateGradeReportCards }, ['Generate All']),
  ]));
  card.appendChild(bulk);

  // Internal marksheet
  const internal = el('div', { style: 'border-top:1px solid #eee;padding-top:16px;' });
  internal.appendChild(el('h3', {}, ['Internal Marksheet (All Grades)']));
  internal.appendChild(el('button', { class: 'btn', onclick: generateInternalMarksheet }, ['Generate Marksheet']));
  card.appendChild(internal);

  card.appendChild(el('div', { id: 'pdf-progress', class: 'muted small', style: 'margin-top:10px;' }));
  body.appendChild(card);
}

async function fetchStudentReportData(studentId) {
  const student = adminCache.students.find(s => s.id === Number(studentId));
  if (!student) return null;
  const grade      = adminCache.grades.find(g => g.id === student.grade_id);
  const subjectIds = adminCache.gradeSubjects.filter(gs => gs.grade_id === student.grade_id).map(gs => gs.subject_id);
  const subjects   = adminCache.subjects.filter(s => subjectIds.includes(s.id));
  const { data: marks }    = await db.from('marks').select('*').eq('student_id', student.id);
  const { data: comments } = await db.from('teacher_comments').select('*').eq('student_id', student.id);
  const marksBySubject = {};
  (marks || []).forEach(m => { marksBySubject[m.subject_id] = m.mark; });
  const commentText = (comments && comments.length) ? comments.map(c => c.comment).join(' ') : '';
  return { student, grade, subjects, marksBySubject, commentText };
}

function buildReportCardHtml(reportData) {
  const { student, grade, subjects, marksBySubject, commentText } = reportData;
  const schoolName   = schoolSettings.school_name || 'School Name';
  const logo         = schoolSettings.logo_url || fallbackLogoDataUri();
  const signatureUrl = schoolSettings.signature_url || '';
  const principal    = schoolSettings.principal_name || 'Principal';

  let totalMarks = 0, count = 0;
  const rows = subjects.map(subject => {
    const mark = Number(marksBySubject[subject.id] || 0);
    totalMarks += mark; count++;
    let gpa = 0;
    if (mark >= 90) gpa = 4.0;
    else if (mark >= 80) gpa = 3.5;
    else if (mark >= 70) gpa = 3.0;
    else if (mark >= 60) gpa = 2.5;
    else if (mark >= 50) gpa = 2.0;
    return `<tr><td>${escapeHtml(subject.name)}</td><td>${mark}</td><td>${letterGrade(mark)}</td><td>${gpa.toFixed(1)}</td></tr>`;
  }).join('');

  const average = count ? totalMarks / count : 0;
  let overallGPA = 0;
  if (average >= 90) overallGPA = 4.0;
  else if (average >= 80) overallGPA = 3.5;
  else if (average >= 70) overallGPA = 3.0;
  else if (average >= 60) overallGPA = 2.5;
  else if (average >= 50) overallGPA = 2.0;

  const commentRow = commentText
    ? `<div style="margin-top:16px;"><strong>Form Teacher's Comment:</strong><div style="border:1px solid #999;padding:8px 10px;min-height:40px;font-size:13px;">${escapeHtml(commentText)}</div></div>`
    : '';

  return `
  <div class="rc-page">
    <div style="text-align:center;">
      <img src="${logo}" style="height:70px;margin-bottom:8px;"/>
      <h1 style="margin:0;font-size:20px;">${escapeHtml(schoolName)}</h1>
      <h2 style="margin:4px 0;font-size:15px;color:#555;">Academic Transcript — Half Yearly Term</h2>
    </div>
    <div style="margin-top:16px;font-size:13px;">
      <strong>Student:</strong> ${escapeHtml(student.name)}&nbsp;&nbsp;
      <strong>ID:</strong> ${escapeHtml(student.student_code)}&nbsp;&nbsp;
      <strong>Grade:</strong> ${escapeHtml(grade?.name || '—')}
    </div>
    <table class="rc-table" style="margin-top:14px;">
      <tr><th>Subject</th><th>Marks</th><th>Grade</th><th>GPA</th></tr>
      ${rows}
      <tr style="font-weight:bold;"><td colspan="3">Overall GPA</td><td>${overallGPA.toFixed(2)}</td></tr>
    </table>
    ${commentRow}
    <div style="margin-top:40px;display:flex;justify-content:flex-end;text-align:center;">
      ${signatureUrl ? `<div><img src="${signatureUrl}" style="height:60px;"/><div style="font-size:12px;border-top:1px solid #333;padding-top:4px;">${escapeHtml(principal)}</div></div>` : ''}
    </div>
    <div style="margin-top:20px;text-align:center;color:#888;font-size:11px;">Generated on: ${new Date().toLocaleDateString()}</div>
  </div>`;
}

async function renderHtmlToPdfBytes(htmlNode) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p','pt','a4');
  await doc.html(htmlNode, { x: 20, y: 20, html2canvas: { scale: 0.8 } });
  return doc.output('arraybuffer');
}

async function mergePdfBuffersAndDownload(pdfBuffers, filename) {
  const { PDFDocument } = window.PDFLib;
  const merged = await PDFDocument.create();
  for (const buffer of pdfBuffers) {
    const src   = await PDFDocument.load(buffer);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach(p => merged.addPage(p));
  }
  const bytes = await merged.save();
  const blob  = new Blob([bytes], { type: 'application/pdf' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

async function generateSingleReportCard() {
  const studentId  = document.getElementById('pdf-student-select').value;
  const progress   = document.getElementById('pdf-progress');
  progress.textContent = 'Generating…';
  const reportData = await fetchStudentReportData(studentId);
  if (!reportData) { progress.textContent = 'Student not found.'; return; }
  const renderArea = document.getElementById('report-render-area');
  renderArea.innerHTML = buildReportCardHtml(reportData);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p','pt','a4');
  await doc.html(renderArea.firstElementChild, { x: 20, y: 20, html2canvas: { scale: 0.8 } });
  doc.save(reportData.student.name.replace(/\s+/g,'_') + '_Report.pdf');
  renderArea.innerHTML = '';
  progress.textContent = 'Done.';
}

async function generateGradeReportCards() {
  const gradeId  = Number(document.getElementById('pdf-grade-select').value);
  const grade    = adminCache.grades.find(g => g.id === gradeId);
  const students = adminCache.students.filter(s => s.grade_id === gradeId);
  const progress = document.getElementById('pdf-progress');
  if (!students.length) { progress.textContent = 'No students in this grade.'; return; }
  const renderArea = document.getElementById('report-render-area');
  const pdfBuffers = [];
  for (let i = 0; i < students.length; i++) {
    progress.textContent = `Generating ${i+1} of ${students.length}: ${students[i].name}…`;
    const reportData = await fetchStudentReportData(students[i].id);
    renderArea.innerHTML = buildReportCardHtml(reportData);
    pdfBuffers.push(await renderHtmlToPdfBytes(renderArea.firstElementChild));
  }
  renderArea.innerHTML = '';
  progress.textContent = 'Combining…';
  await mergePdfBuffersAndDownload(pdfBuffers, (grade?.name || 'Grade').replace(/\s+/g,'') + '_ReportCards.pdf');
  progress.textContent = `Done: ${students.length} report cards.`;
}

async function generateInternalMarksheet() {
  const progress   = document.getElementById('pdf-progress');
  const renderArea = document.getElementById('report-render-area');
  const pdfBuffers = [];
  progress.textContent = 'Generating…';
  for (const grade of adminCache.grades) {
    const students   = adminCache.students.filter(s => s.grade_id === grade.id);
    const subjectIds = adminCache.gradeSubjects.filter(gs => gs.grade_id === grade.id).map(gs => gs.subject_id);
    const subjects   = adminCache.subjects.filter(s => subjectIds.includes(s.id));
    if (!students.length || !subjects.length) continue;
    const { data: marks } = await db.from('marks').select('*').in('student_id', students.map(s => s.id));
    const marksMap = {};
    (marks || []).forEach(m => { marksMap[m.student_id + '-' + m.subject_id] = m.mark; });
    const headerCells = subjects.map(s => `<th>${escapeHtml(s.name)}</th>`).join('');
    const bodyRows    = students.map(stu => {
      const cells = subjects.map(subj => { const v = marksMap[stu.id + '-' + subj.id]; return `<td>${v != null ? v : '-'}</td>`; }).join('');
      return `<tr><td>${escapeHtml(stu.name)}</td>${cells}</tr>`;
    }).join('');
    renderArea.innerHTML = `<div class="rc-page" style="border:none;padding:20px;">
      <div class="rc-header"><div class="rc-school-name">${escapeHtml(schoolSettings.school_name||'School')}</div>
      <div class="rc-title">${escapeHtml(grade.name.toUpperCase())} — INTERNAL MARKSHEET</div></div>
      <table class="rc-table"><tr><th>Student</th>${headerCells}</tr>${bodyRows}</table></div>`;
    pdfBuffers.push(await renderHtmlToPdfBytes(renderArea.firstElementChild));
  }
  renderArea.innerHTML = '';
  if (!pdfBuffers.length) { progress.textContent = 'Nothing to generate yet.'; return; }
  await mergePdfBuffersAndDownload(pdfBuffers, 'Internal_Marksheet.pdf');
  progress.textContent = 'Done: Internal_Marksheet.pdf';
}


/* =============================================================================
   TEACHER PANEL
   Grade-based subject buttons → click → open marks grid for that grade+subject
   Comments are ONLY for form teachers (one comment per student, tied to section)
   ============================================================================= */

let teacherCache = {
  mySubjects: [], grades: [], students: [], gradeSubjects: [],
  sections: [], myFormSections: []
};
let teacherActiveGradeId   = null;
let teacherActiveSubjectId = null;

async function renderTeacherPanel() {
  const root = document.getElementById('teacher-panel');
  root.innerHTML = '<p class="muted">Loading…</p>';

  // Fetch my subject assignments (now includes grade_id)
  const { data: ts } = await db.from('teacher_subjects').select('subject_id,grade_id').eq('teacher_id', currentProfile.id);
  const myTS = ts || [];

  const subjectIds = [...new Set(myTS.map(r => r.subject_id))];
  const gradeIds   = [...new Set(myTS.filter(r => r.grade_id).map(r => r.grade_id))];

  // Fetch form-teacher sections
  const { data: ftRows } = await db.from('form_teachers').select('section_id').eq('teacher_id', currentProfile.id).catch(() => ({ data: [] }));
  const myFormSectionIds = (ftRows || []).map(r => r.section_id);

  const [subjRes, gradeRes, studentRes, gsRes, secRes] = await Promise.all([
    db.from('subjects').select('*').in('id', subjectIds.length ? subjectIds : [-1]),
    db.from('grades').select('*').order('name'),
    db.from('students').select('*').order('name'),
    db.from('grade_subjects').select('*'),
    db.from('sections').select('*').order('name').catch(() => ({ data: [] })),
  ]);

  teacherCache.mySubjects      = subjRes.data   || [];
  teacherCache.grades          = gradeRes.data  || [];
  teacherCache.students        = studentRes.data|| [];
  teacherCache.gradeSubjects   = gsRes.data     || [];
  teacherCache.sections        = secRes.data    || [];
  teacherCache.myFormSections  = myFormSectionIds;
  teacherCache.myTS            = myTS;

  root.innerHTML = '';

  if (!myTS.length) {
    root.appendChild(el('div', { class: 'card' }, [
      el('p', {}, ['No subjects have been assigned to you yet. Ask the admin.'])
    ]));
  } else {
    renderTeacherSubjectButtons(root, myTS);
  }

  // Form-teacher comment section (only if assigned as form teacher)
  if (myFormSectionIds.length) {
    renderFormTeacherCommentSection(root, myFormSectionIds);
  }
}

function renderTeacherSubjectButtons(root, myTS) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', {}, ['My Subjects']));
  card.appendChild(el('p', { class: 'muted small' }, ['Click a button to enter marks for that grade and subject.']));

  // Group by grade
  const gradeGroups = {};
  myTS.forEach(ts => {
    const gid = ts.grade_id || 'ungraded';
    if (!gradeGroups[gid]) gradeGroups[gid] = [];
    gradeGroups[gid].push(ts);
  });

  Object.keys(gradeGroups).forEach(gid => {
    const grade = teacherCache.grades.find(g => g.id === Number(gid));
    const groupLabel = grade ? grade.name : 'General (All Grades)';
    card.appendChild(el('div', { class: 'grade-group-header', style: 'margin-top:10px;' }, [groupLabel]));

    const btnRow = el('div', { class: 'btn-row' });
    gradeGroups[gid].forEach(ts => {
      const subj = teacherCache.mySubjects.find(s => s.id === ts.subject_id);
      if (!subj) return;
      const btnId  = 'tbtn-' + gid + '-' + ts.subject_id;
      const isActive = teacherActiveGradeId === ts.grade_id && teacherActiveSubjectId === ts.subject_id;
      const btn = el('button', {
        id: btnId,
        class: 'btn ' + (isActive ? '' : 'secondary') + ' subject-pill-btn',
        onclick: () => {
          teacherActiveGradeId   = ts.grade_id || null;
          teacherActiveSubjectId = ts.subject_id;
          document.querySelectorAll('.subject-pill-btn').forEach(b => b.classList.replace('btn','btn') || b.classList.add('secondary'));
          document.getElementById(btnId).classList.remove('secondary');
          loadTeacherMarksGrid(ts.grade_id, ts.subject_id);
        }
      }, [subj.name]);
      btnRow.appendChild(btn);
    });
    card.appendChild(btnRow);
  });

  const gridWrap = el('div', { id: 'teacher-marks-grid', style: 'margin-top:16px;' });
  card.appendChild(gridWrap);

  // Auto-open first
  if (myTS.length) {
    teacherActiveGradeId   = myTS[0].grade_id || null;
    teacherActiveSubjectId = myTS[0].subject_id;
    setTimeout(() => loadTeacherMarksGrid(myTS[0].grade_id, myTS[0].subject_id), 0);
  }

  root.appendChild(card);
}

async function loadTeacherMarksGrid(gradeId, subjectId) {
  const gridWrap = document.getElementById('teacher-marks-grid');
  if (!gridWrap) return;
  gridWrap.innerHTML = '<p class="muted">Loading…</p>';

  const grade   = gradeId ? teacherCache.grades.find(g => g.id === gradeId) : null;
  const subject = teacherCache.mySubjects.find(s => s.id === subjectId);

  // Students in this grade who have this subject mapped
  let students;
  if (gradeId) {
    students = teacherCache.students.filter(s => s.grade_id === gradeId);
  } else {
    // No grade filter: all students that have this subject via their grade's mapping
    const gradeIdsForSubject = teacherCache.gradeSubjects.filter(gs => gs.subject_id === subjectId).map(gs => gs.grade_id);
    students = teacherCache.students.filter(s => gradeIdsForSubject.includes(s.grade_id));
  }

  if (!students.length) {
    gridWrap.innerHTML = '<p class="muted">No students found for this assignment.</p>';
    return;
  }

  const { data: marks } = await db.from('marks').select('*')
    .eq('subject_id', subjectId).in('student_id', students.map(s => s.id));
  const marksMap = {};
  (marks || []).forEach(m => { marksMap[m.student_id] = m.mark; });

  gridWrap.innerHTML = '';
  gridWrap.appendChild(el('h3', { style: 'margin-top:0;' }, [
    (grade ? grade.name + ' — ' : '') + (subject ? subject.name : 'Marks')
  ]));

  const gradeSections = gradeId ? teacherCache.sections.filter(s => s.grade_id === gradeId) : [];

  const buildMarksTable = (groupStudents) => {
    const table = el('table');
    table.appendChild(el('tr', {}, [el('th', {}, ['Student']), el('th', {}, ['Mark (0–100)'])]));
    groupStudents.forEach(stu => {
      const markInput = el('input', {
        type: 'number', min: '0', max: '100',
        value: marksMap[stu.id] != null ? marksMap[stu.id] : '',
        id: 'tm-mark-' + stu.id,
        style: 'width:90px;'
      });
      table.appendChild(el('tr', {}, [
        el('td', {}, [stu.name + ' (' + stu.student_code + ')']),
        el('td', {}, [markInput]),
      ]));
    });
    return table;
  };

  if (gradeSections.length) {
    gradeSections.forEach(sec => {
      const secStudents = students.filter(s => s.section_id === sec.id);
      if (!secStudents.length) return;
      gridWrap.appendChild(el('div', { class: 'section-label' }, ['Section ' + sec.name]));
      gridWrap.appendChild(el('div', { class: 'table-wrap', style: 'margin-bottom:8px;' }, [buildMarksTable(secStudents)]));
    });
    const noSec = students.filter(s => !s.section_id);
    if (noSec.length) {
      gridWrap.appendChild(el('div', { class: 'section-label muted' }, ['No Section']));
      gridWrap.appendChild(el('div', { class: 'table-wrap', style: 'margin-bottom:8px;' }, [buildMarksTable(noSec)]));
    }
  } else {
    gridWrap.appendChild(el('div', { class: 'table-wrap', style: 'margin-bottom:8px;' }, [buildMarksTable(students)]));
  }

  gridWrap.appendChild(el('button', {
    class: 'btn', style: 'margin-top:10px;',
    onclick: () => saveTeacherMarks(students, subjectId)
  }, ['💾 Save Marks']));
}

async function saveTeacherMarks(students, subjectId) {
  const markRows = [];
  students.forEach(stu => {
    const inp = document.getElementById('tm-mark-' + stu.id);
    if (inp && inp.value !== '') markRows.push({ student_id: stu.id, subject_id: subjectId, mark: Number(inp.value) });
  });
  if (!markRows.length) { showStatus('No marks entered.', true); return; }
  const { error } = await db.from('marks').upsert(markRows, { onConflict: 'student_id,subject_id' });
  if (error) { showStatus(error.message, true); return; }
  showStatus('Marks saved.');
}

/* ─── Form Teacher Comment Section ───────────────────────────────────────── */
async function renderFormTeacherCommentSection(root, myFormSectionIds) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', {}, ['📝 Form Teacher Comments']));
  card.appendChild(el('p', { class: 'muted small' }, [
    'As a form teacher, you can add a personal comment to each student in your section. ',
    'These comments appear on the report card.'
  ]));

  const loadingEl = el('p', { class: 'muted' }, ['Loading your sections…']);
  card.appendChild(loadingEl);
  root.appendChild(card);

  // Load sections, students, existing comments
  const sections = teacherCache.sections.filter(s => myFormSectionIds.includes(s.id));

  const allStudentsInSections = teacherCache.students.filter(s => myFormSectionIds.includes(s.section_id));
  const studentIds = allStudentsInSections.map(s => s.id);

  const { data: existingComments } = studentIds.length
    ? await db.from('teacher_comments').select('*').eq('teacher_id', currentProfile.id).in('student_id', studentIds)
    : { data: [] };

  const commentMap = {};
  (existingComments || []).forEach(c => { commentMap[c.student_id] = { id: c.id, text: c.comment }; });

  loadingEl.remove();

  sections.forEach(sec => {
    const grade         = teacherCache.grades.find(g => g.id === sec.grade_id);
    const secStudents   = allStudentsInSections.filter(s => s.section_id === sec.id);
    if (!secStudents.length) return;

    card.appendChild(el('div', { class: 'grade-group-header', style: 'margin-top:10px;' }, [
      (grade ? grade.name + ' ' : '') + 'Section ' + sec.name
    ]));

    const table = el('table');
    table.appendChild(el('tr', {}, [el('th', {}, ['Student']), el('th', {}, ['Comment'])]));
    secStudents.forEach(stu => {
      const existingText = commentMap[stu.id]?.text || '';
      const textarea = el('textarea', {
        id: 'ft-comment-' + stu.id,
        style: 'width:100%;min-height:48px;padding:6px;border:1px solid #ccc;border-radius:4px;font-family:inherit;font-size:13px;resize:vertical;',
      });
      textarea.value = existingText;
      table.appendChild(el('tr', {}, [
        el('td', {}, [stu.name + ' (' + stu.student_code + ')']),
        el('td', {}, [textarea]),
      ]));
    });
    card.appendChild(el('div', { class: 'table-wrap', style: 'margin-bottom:8px;' }, [table]));

    card.appendChild(el('button', {
      class: 'btn', style: 'margin-bottom:10px;',
      onclick: () => saveFormTeacherComments(secStudents, commentMap)
    }, ['💾 Save Comments for Section ' + sec.name]));
  });
}

async function saveFormTeacherComments(students, commentMap) {
  for (const stu of students) {
    const ta  = document.getElementById('ft-comment-' + stu.id);
    if (!ta) continue;
    const val = ta.value.trim();
    if (!val) continue;
    const existing = commentMap[stu.id];
    if (existing) {
      await db.from('teacher_comments').update({ comment: val }).eq('id', existing.id);
    } else {
      await db.from('teacher_comments').insert({ student_id: stu.id, teacher_id: currentProfile.id, comment: val });
    }
  }
  showStatus('Comments saved.');
}

/* ─── Teacher PDF generation ─────────────────────────────────────────────── */
// Teachers can still generate report cards for grades they teach
async function teacherGenerateGradeReportCards() {
  const gradeId  = Number(document.getElementById('teacher-pdf-grade')?.value);
  const grade    = teacherCache.grades.find(g => g.id === gradeId);
  const students = teacherCache.students.filter(s => s.grade_id === gradeId);
  const progress = document.getElementById('teacher-pdf-progress');
  if (!students.length) { if (progress) progress.textContent = 'No students in this grade.'; return; }

  const { data: allGradeSubjects } = await db.from('grade_subjects').select('*').eq('grade_id', gradeId);
  const subjectIds  = (allGradeSubjects || []).map(r => r.subject_id);
  const { data: allSubjects } = await db.from('subjects').select('*').in('id', subjectIds.length ? subjectIds : [-1]);
  const renderArea  = document.getElementById('report-render-area');
  const pdfBuffers  = [];

  for (let i = 0; i < students.length; i++) {
    if (progress) progress.textContent = `Generating ${i+1} of ${students.length}: ${students[i].name}…`;
    const stu = students[i];
    const { data: marks }    = await db.from('marks').select('*').eq('student_id', stu.id);
    const { data: comments } = await db.from('teacher_comments').select('*').eq('student_id', stu.id);
    const marksBySubject = {};
    (marks || []).forEach(m => { marksBySubject[m.subject_id] = m.mark; });
    const commentText = (comments && comments.length) ? comments.map(c => c.comment).join(' ') : '';
    renderArea.innerHTML = buildReportCardHtml({ student: stu, grade, subjects: allSubjects || [], marksBySubject, commentText });
    pdfBuffers.push(await renderHtmlToPdfBytes(renderArea.firstElementChild));
  }
  renderArea.innerHTML = '';
  if (progress) progress.textContent = 'Combining…';
  await mergePdfBuffersAndDownload(pdfBuffers, (grade?.name || 'Grade').replace(/\s+/g,'') + '_ReportCards.pdf');
  if (progress) progress.textContent = `Done: ${students.length} report cards.`;
}
