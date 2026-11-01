#!/usr/bin/env python3
"""
FiveM resource test runner.

Runs the real AdvancedAC server-side Lua inside Lua 5.4 (lupa) on top of prelude.lua (a FiveM
runtime emulator) and bridges PerformHttpRequest to the real backend over HTTP.

usage: python3 tests/sim/run.py <scenario.lua> [--backend http://127.0.0.1:8080]
env:   SAC_ORG_ID  (organization to create the test server in), DATABASE_URL
"""
import json, os, re, subprocess, sys, urllib.request, urllib.error
from lupa.lua54 import LuaRuntime

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RES = os.path.join(ROOT, 'resource', 'AdvancedAC')
BACKEND_DIR = os.path.join(ROOT, 'backend')

args = sys.argv[1:]
scenario = args[0]
backend = args[args.index('--backend') + 1] if '--backend' in args else 'http://127.0.0.1:8080'
DB = os.environ.get('DATABASE_URL', 'postgres://sentinel:sentinel_dev@127.0.0.1:5432/sentinel')

lua = LuaRuntime(unpack_returned_tuples=True)
lua_type = lua.globals().type


# ---------------------------------------------------------------- JSON bridge (FiveM semantics)
def to_py(v):
    if lua_type(v) != 'table':
        return v
    keys = list(v.keys())
    if not keys:
        return []                                   # FiveM: empty table encodes as []
    if all(isinstance(k, int) for k in keys) and sorted(keys) == list(range(1, len(keys) + 1)):
        return [to_py(v[i]) for i in range(1, len(keys) + 1)]
    return {str(k): to_py(v[k]) for k in keys}


def to_lua(v):
    if isinstance(v, dict):
        t = lua.table()
        for k, x in v.items():
            if x is not None:
                t[k] = to_lua(x)
        return t
    if isinstance(v, list):
        t = lua.table()
        for i, x in enumerate(v):
            t[i + 1] = to_lua(x)
        return t
    if isinstance(v, float) and v.is_integer() and abs(v) < 2**53:
        return v
    return v


def encode(v):
    return json.dumps(to_py(v), separators=(',', ':'))


def decode(s):
    return to_lua(json.loads(s))


g = lua.globals()
g.json = lua.table(encode=encode, decode=decode)

# ---------------------------------------------------------------- HTTP bridge
HTTP_LOG = []
BACKEND_UP = {'v': True}


def http(method, url, data, headers_json):
    if not BACKEND_UP['v']:
        HTTP_LOG.append((method, url, 0))
        return 0, ''
    headers = json.loads(headers_json) if headers_json else {}
    if isinstance(headers, list):
        headers = {}
    body = data.encode() if data else None
    req = urllib.request.Request(url, data=body if method != 'GET' else None, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            out = r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        out = e.code, e.read().decode()
    except Exception as e:  # connection refused etc. → status 0 like FiveM
        out = 0, ''
    HTTP_LOG.append((method, url, out[0]))
    if out[0] >= 400:
        print(f'[HTTP] {method} {url} -> {out[0]} {out[1][:300]}')
    return out


g.__http = http


def sql(q):
    r = subprocess.run(['psql', DB, '-tAc', q], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def backend_up(v):
    BACKEND_UP['v'] = bool(v)


def http_count(path_part, status=None):
    return sum(1 for m, u, s in HTTP_LOG if path_part in u and (status is None or s == status))


def node(*a):
    r = subprocess.run(['node', 'src/cli.js', *a], cwd=BACKEND_DIR, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout


def api(method, path, body=None, cookie=None):
    """Dashboard API helper for scenarios (path relative to /api/v1)."""
    h = {'Content-Type': 'application/json', 'X-SAC-Request': '1'}
    if cookie:
        h['Cookie'] = cookie
    req = urllib.request.Request(backend + '/api/v1' + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode()
            setc = r.headers.get('Set-Cookie')
            return r.status, raw, setc or ''
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), ''


import time
g.__sleep = lambda sec: time.sleep(sec)
import base64, io as _io
def jpeg(label):
    """Real JPEG frame for the screenshot-basic emulation (so the browser can decode it)."""
    from PIL import Image, ImageDraw
    im = Image.new('RGB', (640, 360))
    d = ImageDraw.Draw(im)
    for y in range(360):
        d.line([(0, y), (640, y)], fill=(20 + y // 6, 40 + y // 5, 70 + y // 4))
    d.rectangle([0, 300, 640, 360], fill=(40, 60, 40))
    d.text((20, 20), 'screenshot-basic (emulated)', fill=(255, 255, 255))
    d.text((20, 44), str(label), fill=(255, 220, 120))
    buf = _io.BytesIO(); im.save(buf, 'JPEG', quality=70)
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()
g.__jpeg = jpeg
g.__sql = sql
g.__backend_up = backend_up
g.__http_count = http_count
g.__node = node
g.__api = api
g.__py_json = lambda s: decode(s)

# ---------------------------------------------------------------- test server provisioning
org = os.environ.get('SAC_ORG_ID') or sql("SELECT id FROM organizations ORDER BY created_at LIMIT 1")
created = json.loads(node('server:create', '--org', org, '--name', 'Sim Server ' + os.path.basename(scenario)))
g.TEST = lua.table(serverId=created['id'], apiKey=created['apiKey'], orgId=org, backend=backend)

with open(os.path.join(os.path.dirname(__file__), 'prelude.lua')) as f:
    lua.execute(f.read())

lua.execute(f"""
SIM.convars['sentinel_backend'] = '{backend}'
SIM.convars['sentinel_api_key'] = TEST.apiKey
SIM.convars['web_baseUrl'] = 'sim-{created['id'][:8]}.users.cfx.re'
SIM.convars['onesync'] = 'on'
SIM.convars['sv_hostname'] = 'Sim Server'
SIM.convars['sv_maxclients'] = '64'
SIM.resources['AdvancedAC'] = 'started'
SIM.resources['screenshot-basic'] = 'started'
SIM.resources['chat'] = 'started'
SIM.resources['qb-core'] = 'missing'
""")

# ---------------------------------------------------------------- load resource (fxmanifest order)
manifest = open(os.path.join(RES, 'fxmanifest.lua')).read()


def block(name):
    m = re.search(name + r"\s*\{([^}]*)\}", manifest)
    return re.findall(r"'([^']+)'", m.group(1)) if m else []


files = block('shared_scripts') + block('server_scripts')
for rel in files:
    path = os.path.join(RES, rel)
    if not os.path.exists(path):
        print(f'[SIM] missing file (not yet implemented): {rel}')
        continue
    with open(path) as f:
        lua.execute(f.read())

# ---------------------------------------------------------------- scenario
results = {'pass': 0, 'fail': 0}


def check(cond, msg):
    if cond:
        results['pass'] += 1
        print(f'  \033[32m✔\033[0m {msg}')
    else:
        results['fail'] += 1
        print(f'  \033[31m✘ {msg}\033[0m')


g.check = check
g.HELPERS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'helpers.lua')
with open(scenario) as f:
    lua.execute(f.read())

errors = g.SIM.errors or 0
print(f"\n{results['pass']} passed, {results['fail']} failed, {errors} runtime errors")
sys.exit(1 if results['fail'] or errors else 0)
