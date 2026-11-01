#!/usr/bin/env python3
"""EventGuard runs inside third-party resources: test it in an isolated Lua state."""
import os, sys
from lupa.lua54 import LuaRuntime
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
lua = LuaRuntime(unpack_returned_tuples=True)
lua.execute(r"""
NOW = 0
handlers, reports = {}, {}
function IsDuplicityVersion() return true end
function GetCurrentResourceName() return 'my-shop' end
function GetResourceState() return 'started' end
function GetGameTimer() return NOW end
function GetPlayerName(s) return (tonumber(s) or 0) > 0 and 'p' .. s or nil end
function CreateThread(fn) local co = coroutine.create(fn); coroutine.resume(co) end
function Wait() coroutine.yield() end
function RegisterNetEvent(name, fn) if fn then handlers[name] = handlers[name] or {}; table.insert(handlers[name], fn) end end
function AddEventHandler(name, fn) handlers[name] = handlers[name] or {}; table.insert(handlers[name], fn) end
exports = setmetatable({}, { __index = function() return {
  GuardConfig = function() return { enabled = true, perSecond = 40, perEventPerSecond = 15 } end,
  GuardReport = function(_, src, key, d) table.insert(reports, { src = src, key = key, d = d }) end } end })
function fire(name, src, ...) source = src; local n = 0; for _, f in ipairs(handlers[name] or {}) do f(...); end end
""")
lua.execute(open(os.path.join(ROOT, 'resource/AdvancedAC/shared/eventguard.lua')).read())
# guard reads config in a thread; emulate the refresh
lua.execute("""
calls = 0
RegisterNetEvent('shop:buy', function(item, n) calls = calls + 1 end)
Guard.validate('shop:buy', function(item, n) return type(item) == 'string' and math.type(n) == 'integer' and n > 0 and n <= 100 end)
Guard.serverOnly('shop:server:pay')
""")
g = lua.globals()
ok = fail = 0
def check(c, m):
    global ok, fail
    print(('  \033[32m✔\033[0m ' if c else '  \033[31m✘ ') + m + ('' if c else '\033[0m'))
    if c: ok += 1
    else: fail += 1

lua.execute("fire('shop:buy', 3, 'apple', 2)")
check(g.calls == 1, 'valid call passes through to the handler')
lua.execute("fire('shop:buy', 3, 'apple', 99999)")
check(g.calls == 1 and any(r['key'] == 'event_invalid_args' for r in g.reports.values()), 'invalid arguments dropped + event_invalid_args reported')
lua.execute("fire('shop:server:pay', 4, 5000)")
check(any(r['key'] == 'event_serveronly' and r['src'] == 4 for r in g.reports.values()), 'client triggering server-only event reported')
lua.execute("source = ''; fire('shop:buy', '', 'apple', 1)")
check(g.calls == 2, 'server-originated (non-player) calls are never blocked')
lua.execute("NOW = 5000; for i = 1, 16 do fire('shop:buy', 7, 'apple', 1) end")
check(any(r['key'] == 'event_spam' and r['src'] == 7 for r in g.reports.values()), '16 calls/second of one event → event_spam reported')
check(g.calls == 2 + 15, 'calls above the per-event limit are dropped (15 passed, 16th blocked)')
lua.execute("NOW = 6000; fire('shop:buy', 7, 'apple', 1)")
check(g.calls == 18, 'limit resets the next second')
print(f'\n{ok} passed, {fail} failed')
sys.exit(1 if fail else 0)
