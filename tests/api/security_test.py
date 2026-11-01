#!/usr/bin/env python3
"""API security tests: tenant isolation, RBAC, privilege escalation, CSRF, agent auth."""
import json, subprocess, sys, urllib.request, urllib.error, uuid, os
B = 'http://127.0.0.1:8080/api/v1'
DB = os.environ.get('DATABASE_URL', 'postgres://sentinel:sentinel_dev@127.0.0.1:5432/sentinel')
ok = fail = 0
def check(c, m):
    c = bool(c)
    global ok, fail
    print(('  \033[32m✔\033[0m ' if c else '  \033[31m✘ ') + m + ('' if c else '\033[0m')); ok += c; fail += (not c)
def req(method, path, body=None, cookie=None, csrf=True, headers=None):
    h = {'Content-Type': 'application/json', **({'X-SAC-Request': '1'} if csrf else {}), **(headers or {})}
    if cookie: h['Cookie'] = cookie
    r = urllib.request.Request(B + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
    try:
        with urllib.request.urlopen(r) as x: return x.status, json.loads(x.read() or b'null'), x.headers.get('Set-Cookie', '')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null'), ''
def sql(q): return subprocess.run(['psql', DB, '-tAc', q], capture_output=True, text=True).stdout.strip()
def login(email, pw):
    s, _, c = req('POST', '/auth/login', {'email': email, 'password': pw}); return c.split(';')[0] if s == 200 else None
cli = lambda *a: json.loads(subprocess.run(['node', 'src/cli.js', *a], cwd=os.path.join(os.path.dirname(__file__), '../../backend'), capture_output=True, text=True).stdout)

tag = uuid.uuid4().hex[:6]
other = cli('org:create', '--name', 'Other ' + tag, '--email', f'other{tag}@x.io', '--owner', 'Other', '--password', 'OtherPass123')
a = login('owner@test.local', 'Sentinel2026dev'); o = login(f'other{tag}@x.io', 'OtherPass123')
check(a and o, 'both org owners can log in')
pid = sql("SELECT p.id FROM players p JOIN organizations g ON g.id=p.org_id WHERE g.name='Test Org' LIMIT 1")
bid = sql("SELECT b.id FROM bans b JOIN organizations g ON g.id=b.org_id WHERE g.name='Test Org' LIMIT 1")
srv = sql("SELECT s.id FROM servers s JOIN organizations g ON g.id=s.org_id WHERE g.name='Test Org' LIMIT 1")
check(req('GET', f'/players/{pid}', cookie=o)[0] == 404, 'other org cannot read our player profile')
check(req('GET', f'/bans/{bid}', cookie=o)[0] == 404, 'other org cannot read our ban')
check(req('POST', f'/bans/{bid}/revoke', {'reason': 'nope'}, cookie=o)[0] in (404, 409), 'other org cannot revoke our ban')
check(req('GET', f'/servers/{srv}/players', cookie=o)[1] == [], 'other org gets no online players of our server')
check(req('POST', f'/servers/{srv}/console', {'command': 'quit'}, cookie=o)[0] == 404, 'other org cannot run console commands on our server')
check(req('GET', '/lookup?q=Hamad', cookie=o)[1]['results'] == [], 'global lookup is scoped to the organization')

# RBAC: create a Support user (no ban permission)
roles = req('GET', '/roles', cookie=a)[1]; support = next(r for r in roles if r['name'] == 'Support'); mod = next(r for r in roles if r['name'] == 'Moderator')
s, r, _ = req('POST', '/admins', {'email': f'sup{tag}@x.io', 'name': 'Sup', 'password': 'SupportPass1', 'roleId': support['id']}, cookie=a)
check(s == 200, 'owner creates a Support administrator')
sc = login(f'sup{tag}@x.io', 'SupportPass1')
check(req('POST', f'/players/{pid}/ban', {'reason': 'test ban', 'durationHours': 0}, cookie=sc)[0] == 403, 'Support cannot ban (403)')
check(req('GET', '/audit', cookie=sc)[0] == 403, 'Support cannot read the audit log')
check(req('PUT', '/detections/config/speed_onfoot', {'enabled': False}, cookie=sc)[0] == 403, 'Support cannot change detection config')
check(req('GET', '/players/' + pid, cookie=sc)[0] == 200, 'Support can view players (granted)')
# Privilege escalation
check(req('PATCH', f'/admins/{r["id"]}', {'extraPermissions': ['admins.manage']}, cookie=sc)[0] == 403, 'Support cannot grant itself admins.manage')
s, r2, _ = req('POST', '/admins', {'email': f'mod{tag}@x.io', 'name': 'Mod', 'password': 'ModeratorPass1', 'roleId': mod['id'], 'extraPermissions': ['admins.manage']}, cookie=a)
mc = login(f'mod{tag}@x.io', 'ModeratorPass1')
owner_role = next(x for x in roles if x['name'] == 'Owner')
check(req('POST', '/admins', {'email': f'esc{tag}@x.io', 'name': 'Esc', 'password': 'EscalatePass1', 'roleId': owner_role['id']}, cookie=mc)[0] == 403, 'Moderator with admins.manage cannot create an Owner')
check(req('PUT', f'/roles/{mod["id"]}', {'permissions': ['console.execute']}, cookie=mc)[0] == 403, 'Moderator cannot edit its own role')
check(req('PATCH', f'/admins/{r["id"]}', {'extraPermissions': ['console.execute']}, cookie=mc)[0] == 403, 'cannot grant a permission you do not have')
# CSRF + session
check(req('POST', f'/players/{pid}/notes', {'body': 'x'}, cookie=a, csrf=False)[0] == 403, 'mutation without X-SAC-Request header rejected (CSRF)')
check(req('GET', '/auth/me')[0] == 401, 'unauthenticated API access rejected')
check(req('GET', '/auth/me', cookie='sac_session=sac_sess_forged')[0] == 401, 'forged session token rejected')
req('PATCH', f'/admins/{r["id"]}', {'active': False}, cookie=a)
check(req('GET', '/auth/me', cookie=sc)[0] == 401, 'disabling an admin kills their sessions immediately')
# Agent API
check(req('POST', '/agent/heartbeat', {}, csrf=False)[0] == 401, 'agent API without key rejected')
check(req('POST', '/agent/heartbeat', {}, csrf=False, headers={'Authorization': 'Bearer sac_srv_' + 'x' * 40})[0] == 401, 'agent API with an invalid key rejected')
check(req('GET', f'/evidence/{uuid.uuid4()}/file', cookie=o)[0] == 404, 'evidence files are org-scoped')
# Public appeal: no enumeration
s1, b1, _ = req('POST', '/public/appeal', {'banId': 'SB-AAAAAAAA', 'message': 'x' * 30}, csrf=False)
s2, b2, _ = req('POST', '/public/appeal', {'banId': bid, 'message': 'This is a genuine appeal message.'}, csrf=False)
check(s1 == s2 == 200 and b1 == b2, 'appeal endpoint gives identical answers for valid/invalid ban IDs')
chain = req('GET', '/audit/verify', cookie=a)[1]
check(chain['ok'], f'audit hash chain intact ({chain["checked"]} entries)')
try:
    subprocess.run(['psql', DB, '-c', 'UPDATE audit_log SET actor_name=\'x\' WHERE id=(SELECT min(id) FROM audit_log)'], capture_output=True, text=True, check=True); tampered = True
except subprocess.CalledProcessError: tampered = False
check(not tampered, 'audit_log rejects UPDATE at the database level')
print(f'\n{ok} passed, {fail} failed'); sys.exit(1 if fail else 0)
