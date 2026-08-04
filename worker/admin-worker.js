/**
 * 두암한방병원 홈페이지 관리자 저장 서버 (Cloudflare Worker)
 *
 * 흐름
 *   브라우저(#/admin) → 이 Worker → GitHub 커밋 → GitHub Pages 재배포 → 홈페이지 반영
 *
 * 이 Worker가 존재하는 이유
 *   GitHub에 글을 쓰려면 토큰이 필요한데, 토큰을 브라우저에 두면 누구나 볼 수 있다.
 *   그래서 토큰은 이곳(서버)의 secret 으로만 두고, 브라우저는 비밀번호(PIN)만 보낸다.
 *
 * 필요한 secret (wrangler secret put 으로 등록 — "설정 안내.md" 참고)
 *   ADMIN_PIN     관리자 비밀번호(숫자 4~6자리)
 *   GITHUB_TOKEN  이 저장소 Contents 쓰기 권한만 가진 fine-grained PAT
 *
 * 필요한 변수 (wrangler.toml [vars])
 *   GITHUB_OWNER / GITHUB_REPO / GITHUB_BRANCH / ALLOWED_ORIGINS
 */

const FILES = {
  notices: 'data/notices.json',
  columns: 'data/columns.json',
};
const LOG_FILE = 'data/log.json';
const LOG_MAX = 100;                 // 이 개수를 넘으면 오래된 기록부터 지운다
const UPLOAD_DIR = 'data/uploads';
const NOTICE_TYPES = ['notice', 'closed', 'event'];
// 'deleted' = 휴지통. 실제로 지우지 않고 상태만 바꿔 두고, 관리자페이지에서 7일간 복구할 수 있다.
const NOTICE_STATUS = ['published', 'draft', 'hidden', 'deleted'];
const COLUMN_STATUS = ['published', 'draft', 'deleted'];
const COLUMN_CATS = ['spine', 'rehab', 'accident', 'women', 'fatigue', 'cancer'];
const MAX_PINNED = 3;
const MAX_IMAGE_B64 = 2_000_000; // 약 1.5MB — 브라우저에서 이미 줄여서 보낸다

// 비밀번호를 여러 번 틀리면 잠시 늦춘다. Worker 인스턴스 메모리라 완벽한 차단은 아니고
// 자동 대입을 느리게 만드는 정도의 장치다. (더 강한 차단은 Cloudflare 대시보드의
// Rate limiting rules 를 쓰면 된다 — "설정 안내.md" 6단계)
const failures = new Map();
const BLOCK_AFTER = 10;
const BLOCK_MS = 10 * 60 * 1000;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ ok: false, error: '잘못된 요청입니다.' }, 405, cors);
    if (!cors['Access-Control-Allow-Origin']) {
      return json({ ok: false, error: '허용되지 않은 주소에서의 요청입니다.' }, 403, corsHeaders('', env));
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: '요청 내용을 읽지 못했습니다.' }, 400, cors);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const blocked = blockedUntil(ip);
    if (blocked) {
      return json({ ok: false, error: `비밀번호를 여러 번 틀렸습니다. ${Math.ceil(blocked / 60000)}분 뒤에 다시 시도해 주세요.` }, 429, cors);
    }

    if (!env.ADMIN_PIN || !env.GITHUB_TOKEN) {
      return json({ ok: false, error: '서버 설정이 끝나지 않았습니다. (ADMIN_PIN / GITHUB_TOKEN 미등록)' }, 500, cors);
    }
    if (!safeEqual(String(body.pin || ''), String(env.ADMIN_PIN))) {
      await noteFailure(ip);
      return json({ ok: false, error: '비밀번호가 맞지 않습니다.' }, 401, cors);
    }
    failures.delete(ip);

    try {
      const result = await handle(body, env);
      return json({ ok: true, ...result }, 200, cors);
    } catch (err) {
      return json({ ok: false, error: err.message || '저장 중 문제가 생겼습니다.' }, err.status || 500, cors);
    }
  },
};

// ---- 실제 처리 ----
async function handle(body, env) {
  const action = String(body.action || '');
  if (action === 'ping') return {};                       // 비밀번호 확인만 하는 요청
  if (body.type === 'image' && action === 'upload') return uploadImage(body.data, env);

  const type = String(body.type || '');
  if (!FILES[type]) throw bad('알 수 없는 종류입니다.');
  if (!['create', 'update', 'delete', 'restore', 'purge'].includes(action)) throw bad('알 수 없는 요청입니다.');

  // 누가 고쳤는지 기록하기 위한 이름. 인증이 아니라 자기신고(관리자페이지에서 고른 값)다.
  const actor = str(body.actor, 20) || '이름 없음';
  const file = await readJson(FILES[type], env);
  const items = Array.isArray(file.json.items) ? file.json.items : [];
  const id = String(body.id || (body.data && body.data.id) || '');
  if (!id) throw bad('글 번호가 없습니다.');
  const at = items.findIndex((it) => String(it.id) === id);

  let label;
  if (action === 'delete') {
    // 바로 지우지 않고 휴지통으로 옮긴다(관리자페이지에서 7일간 복구 가능).
    if (at < 0) throw bad('이미 삭제된 글입니다.');
    if (items[at].status === 'deleted') throw bad('이미 휴지통에 있는 글입니다.');
    label = items[at].title;
    items[at] = {
      ...items[at],
      status: 'deleted',
      previousStatus: items[at].status || 'draft',
      deletedAt: today(),
      lastEditedBy: actor,
      lastEditedAt: today(),
    };
  } else if (action === 'restore') {
    if (at < 0) throw bad('없는 글입니다.');
    if (items[at].status !== 'deleted') throw bad('휴지통에 있는 글이 아닙니다.');
    label = items[at].title;
    const statuses = type === 'notices' ? NOTICE_STATUS : COLUMN_STATUS;
    const back = items[at].previousStatus;
    items[at] = {
      ...items[at],
      status: statuses.includes(back) && back !== 'deleted' ? back : 'draft',
      previousStatus: '',
      deletedAt: '',
      lastEditedBy: actor,
      lastEditedAt: today(),
    };
  } else if (action === 'purge') {
    if (at < 0) throw bad('이미 삭제된 글입니다.');
    if (items[at].status !== 'deleted') throw bad('휴지통에 있는 글만 완전히 지울 수 있습니다.');
    label = items[at].title;
    items.splice(at, 1);
  } else {
    const clean = type === 'notices' ? cleanNotice(body.data, id) : cleanColumn(body.data, id);
    if (!clean.title) throw bad('제목이 비어 있습니다.');
    label = clean.title;
    clean.lastEditedBy = actor;
    clean.lastEditedAt = today();
    // 임시저장 칼럼에는 미리보기 주소용 토큰을 붙인다. 이미 있으면 그대로 둔다.
    if (type === 'columns' && clean.status === 'draft' && !clean.previewToken) {
      clean.previewToken = (at >= 0 && safeToken(items[at].previewToken)) || randomId(12);
    }
    if (at >= 0) items[at] = { ...items[at], ...clean };
    else items.unshift(clean);
  }

  if (type === 'notices' && items.filter((n) => n.pinned && n.status !== 'deleted').length > MAX_PINNED) {
    throw bad(`상단 고정은 최대 ${MAX_PINNED}개까지 가능합니다.`);
  }

  const verb = { create: '추가', update: '수정', delete: '삭제', restore: '복구', purge: '완전 삭제' }[action];
  const what = type === 'notices' ? '공지사항' : '건강 칼럼';
  const next = { ...file.json, version: file.json.version || 1, updatedAt: today(), items };

  await writeJson(FILES[type], next, file.sha, `[콘텐츠] ${what} ${verb}: ${label}`, env);
  await appendLog({ actor, action, itemType: type, itemId: id, title: label }, `${what} ${verb}: ${label}`, env);
  return { items };
}

// 변경 이력(누가·언제·무엇을)을 data/log.json 에 한 줄 덧붙인다.
// 글 저장은 이미 끝난 뒤라, 이력 기록이 실패해도 저장 자체를 되돌리지는 않는다.
async function appendLog(entry, summary, env) {
  try {
    const file = await readJson(LOG_FILE, env);
    const items = Array.isArray(file.json.items) ? file.json.items : [];
    items.unshift({
      at: new Date().toISOString(),
      actor: entry.actor,
      action: entry.action,
      itemType: entry.itemType,
      itemId: entry.itemId,
      title: str(entry.title, 200),
    });
    const next = { ...file.json, version: file.json.version || 1, updatedAt: today(), items: items.slice(0, LOG_MAX) };
    await writeJson(LOG_FILE, next, file.sha, `[콘텐츠] 변경 이력 기록: ${summary}`, env);
  } catch {
    /* 이력은 참고용이라 실패해도 넘어간다 */
  }
}

async function uploadImage(data, env) {
  const b64 = String((data && data.base64) || '').replace(/\s+/g, '');
  if (!b64) throw bad('사진 내용이 비어 있습니다.');
  if (b64.length > MAX_IMAGE_B64) throw bad('사진 용량이 너무 큽니다. 조금 더 작은 사진을 올려 주세요.');
  if (!/^[A-Za-z0-9+/=]+$/.test(b64)) throw bad('사진 형식이 올바르지 않습니다.');

  // 파일 이름은 서버가 정한다(한글·공백·중복 문제를 피하기 위함)
  const name = `${today().replace(/-/g, '')}-${randomId(6)}.jpg`;
  const path = `${UPLOAD_DIR}/${name}`;
  await putFile(path, b64, null, `[콘텐츠] 칼럼 사진 추가: ${name}`, env);
  return { path };
}

// ---- 들어온 값을 스키마대로 정리 (임의 필드·과도한 길이 차단) ----
function str(v, max) {
  return String(v == null ? '' : v).slice(0, max).trim();
}
function isoDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';
}
function safeImagePath(v) {
  const p = str(v, 200);
  if (!p) return '';
  return /^data\/uploads\/[\w-]+\.(jpe?g|png|webp)$/i.test(p) || /^https:\/\//i.test(p) ? p : '';
}
// 유튜브 주소(watch·youtu.be·embed·shorts·live)에서 11자리 영상 번호만 뽑는다.
// 브라우저에서도 같은 검사를 하지만, 화면을 거치지 않은 요청이 올 수 있어 서버에서 다시 확인한다.
function youtubeId(v) {
  const s = str(v, 200);
  if (!s) return '';
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : '';
}
function safeVideoId(v) {
  const raw = str(v, 200);
  const id = youtubeId(raw);
  if (raw && !id) throw bad('유튜브 영상 주소를 알아보지 못했습니다. 주소를 다시 확인해 주세요.');
  return id;
}
function safeToken(v) {
  const t = str(v, 32);
  return /^[a-z0-9]{1,32}$/.test(t) ? t : '';
}
function prevStatus(v, list) {
  return list.includes(v) && v !== 'deleted' ? v : '';
}
function cleanNotice(d, id) {
  d = d || {};
  return {
    id: str(id, 64),
    title: str(d.title, 200),
    date: isoDate(d.date),
    type: NOTICE_TYPES.includes(d.type) ? d.type : 'notice',
    status: NOTICE_STATUS.includes(d.status) ? d.status : 'draft',
    pinned: !!d.pinned,
    previousStatus: prevStatus(d.previousStatus, NOTICE_STATUS),
    deletedAt: isoDate(d.deletedAt),
    lastEditedBy: '',   // 아래 handle()에서 채운다
    lastEditedAt: '',
    body: str(d.body, 8000),
  };
}
function cleanColumn(d, id) {
  d = d || {};
  return {
    id: str(id, 64),
    title: str(d.title, 200),
    tag: str(d.tag, 40),
    category: COLUMN_CATS.includes(d.category) ? d.category : 'spine',
    author: str(d.author, 40),
    date: isoDate(d.date),
    status: COLUMN_STATUS.includes(d.status) ? d.status : 'draft',
    image: safeImagePath(d.image),
    imageAlt: str(d.imageAlt, 200),
    videoId: safeVideoId(d.videoId),
    previewToken: safeToken(d.previewToken),
    previousStatus: prevStatus(d.previousStatus, COLUMN_STATUS),
    deletedAt: isoDate(d.deletedAt),
    lastEditedBy: '',   // 아래 handle()에서 채운다
    lastEditedAt: '',
    body: str(d.body, 30000),
  };
}

// ---- GitHub Contents API ----
function gh(path, env) {
  return `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;
}
function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'duam-admin-worker',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}
async function readJson(path, env) {
  const branch = env.GITHUB_BRANCH || 'main';
  const res = await fetch(`${gh(path, env)}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders(env) });
  if (res.status === 404) throw bad(`${path} 파일을 찾지 못했습니다.`);
  if (!res.ok) throw bad(await ghError(res, '파일을 읽지 못했습니다'));
  const meta = await res.json();
  let json;
  try {
    json = JSON.parse(b64ToText(meta.content || ''));
  } catch {
    throw bad(`${path} 내용을 해석하지 못했습니다.`);
  }
  return { json, sha: meta.sha };
}
async function writeJson(path, obj, sha, message, env) {
  try {
    await putFile(path, textToB64(JSON.stringify(obj, null, 2) + '\n'), sha, message, env);
  } catch (err) {
    // 읽은 뒤 저장하기 전에 다른 곳에서 같은 파일이 바뀐 경우.
    // 여기서 그냥 덮어쓰면 상대의 수정이 사라지므로 알리고 멈춘다.
    if (err.status === 409) throw bad('다른 곳에서 먼저 저장되었습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.');
    throw err;
  }
}
async function putFile(path, contentB64, sha, message, env) {
  const payload = { message, content: contentB64, branch: env.GITHUB_BRANCH || 'main' };
  if (sha) payload.sha = sha;
  const res = await fetch(gh(path, env), {
    method: 'PUT',
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = bad(await ghError(res, '저장하지 못했습니다'));
    err.status = res.status === 409 ? 409 : 502;
    throw err;
  }
  return res.json();
}
async function ghError(res, prefix) {
  let detail = '';
  try {
    const j = await res.json();
    detail = j && j.message ? ` (${j.message})` : '';
  } catch { /* 본문이 없을 수 있다 */ }
  // GitHub 응답을 그대로 노출하지 않고, 토큰과 무관한 요약만 전달한다.
  if (res.status === 401 || res.status === 403) return `${prefix}: 저장소 접근 권한을 확인해 주세요.`;
  return `${prefix}${detail}`;
}

// ---- 도구 ----
function corsHeaders(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
function bad(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function blockedUntil(ip) {
  const f = failures.get(ip);
  if (!f || f.count < BLOCK_AFTER) return 0;
  const left = f.at + BLOCK_MS - Date.now();
  if (left <= 0) {
    failures.delete(ip);
    return 0;
  }
  return left;
}
async function noteFailure(ip) {
  const f = failures.get(ip) || { count: 0, at: 0 };
  f.count += 1;
  f.at = Date.now();
  failures.set(ip, f);
  // 틀릴수록 응답을 늦춰 자동 대입 속도를 떨어뜨린다 (최대 8초)
  await new Promise((r) => setTimeout(r, Math.min(f.count, 8) * 1000));
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function randomId(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}
function b64ToText(b64) {
  const bin = atob(String(b64).replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}
function textToB64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
