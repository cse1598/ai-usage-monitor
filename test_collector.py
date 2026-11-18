import unittest, tempfile, pathlib, os, json, time
from unittest.mock import patch
import collector as c

class Tests(unittest.TestCase):
    def test_codex(self):
        r=c.parse_codex({'rateLimitsByLimitId':{'codex':{'limitId':'codex','primary':{'usedPercent':22,'windowDurationMins':300,'resetsAt':2000000000},'secondary':{'usedPercent':68,'windowDurationMins':10080,'resetsAt':2000100000}}}})
        self.assertEqual(r['codex_5h']['remaining'],78)
        self.assertEqual(r['codex_week']['remaining'],32)
    def test_claude(self):
        r=c.parse_claude({'rate_limits_available':True,'rate_limits':{'five_hour':{'utilization':35,'resets_at':'2030-01-01T00:00:00Z'},'seven_day':{'utilization':59},'model_scoped':[{'display_name':'Fable','utilization':88},{'display_name':'Opus','utilization':2}]}})
        self.assertEqual(r['claude_5h']['remaining'],65)
        self.assertEqual(r['claude_week']['remaining'],41)
        self.assertNotIn('claude_fable',r)
        self.assertEqual(r['claude_5h']['reset_at'],1893456000)
    def test_claude_actual_schema(self):
        r=c.parse_claude({'rate_limits': {'five_hour': {'utilization': 0, 'resets_at': None}, 'seven_day': {'utilization': 65, 'resets_at': '2026-11-22T18:59:59.648760+00:00'}, 'limits': [{'kind':'session','percent':0,'resets_at':None,'is_active':False}, {'kind':'weekly_all','percent':65,'resets_at':'2026-11-22T18:59:59.648760+00:00','is_active':True}], 'model_scoped':[]}})
        self.assertEqual(set(r), {'claude_5h','claude_week'})
        self.assertEqual(r['claude_5h']['remaining'],100)
        self.assertIsNone(r['claude_5h']['reset_at'])
        self.assertFalse(r['claude_5h']['active'])
        self.assertEqual(r['claude_week']['remaining'],35)
        self.assertTrue(r['claude_week']['active'])
    def test_missing(self):
        self.assertIsNone(c.window({'utilization':None},'utilization','resets_at'))
        self.assertNotIn('claude_fable',c.parse_claude({'rate_limits':{'five_hour':{'utilization':0}}}))
        with self.assertRaises(c.QueryError): c.parse_codex({'rateLimits':{'primary':{'windowDurationMins':15,'usedPercent':50}}})
    def test_cache(self):
        with tempfile.TemporaryDirectory() as d:
            path=pathlib.Path(d)/'cache.json'
            with patch.object(c,'CACHE',path),patch.object(c,'find_cli',side_effect=lambda name,config:'/fake/'+name),patch.object(c,'query_codex',return_value={'codex_5h':{'remaining':42}}),patch.object(c,'query_claude',side_effect=c.QueryError('offline')):
                first=c.collect({});self.assertEqual(first['rows']['codex_5h']['remaining'],42); self.assertIsNone(first['rows']['claude_5h'])
            with patch.object(c,'CACHE',path),patch.object(c,'find_cli',side_effect=lambda name,config:'/fake/'+name),patch.object(c,'query_codex',side_effect=c.QueryError('offline')),patch.object(c,'query_claude',side_effect=c.QueryError('offline')):
                self.assertTrue(c.collect({})['rows']['codex_5h']['stale'])
    def check_detection(self, installed):
        with tempfile.TemporaryDirectory() as d:
            path=pathlib.Path(d)/'cache.json'
            path.write_text(json.dumps({'rows':{key:{'remaining':42} for keys in c.KEYS.values() for key in keys}}))
            with patch.object(c,'CACHE',path), patch.object(c,'find_cli',side_effect=lambda name,config:'/fake/'+name if name in installed else None), patch.object(c,'query_codex',return_value={'codex_5h':{'remaining':78}}) as codex, patch.object(c,'query_claude',return_value={'claude_5h':{'remaining':65}}) as claude:
                r=c.collect({})
                self.assertEqual(r['providers'],{name:name in installed for name in c.KEYS})
                self.assertEqual(set(r['rows']),{key for name in installed for key in c.KEYS[name]})
                self.assertEqual(r['errors'],{})
                self.assertEqual(codex.call_count,int('codex' in installed))
                self.assertEqual(claude.call_count,int('claude' in installed))
                self.assertEqual(json.loads(path.read_text()),r)
    def test_only_codex(self): self.check_detection({'codex'})
    def test_only_claude(self): self.check_detection({'claude'})
    def test_neither_installed(self): self.check_detection(set())
    def test_both_installed(self): self.check_detection({'codex','claude'})
    def test_protocol(self):
        with tempfile.TemporaryDirectory() as d:
            path=pathlib.Path(d)/'fake-cli';path.write_text('''#!/usr/bin/env python3
import sys,json
for line in sys.stdin:
 m=json.loads(line)
 if m.get('method')=='initialize': print(json.dumps({'id':1,'result':{}}),flush=True)
 elif m.get('method')=='account/rateLimits/read': print(json.dumps({'id':2,'result':{'rateLimits':{'primary':{'windowDurationMins':300,'usedPercent':22},'secondary':{'windowDurationMins':10080,'usedPercent':68}}}}),flush=True)
 elif m.get('type')=='control_request': print(json.dumps({'type':'control_response','response':{'request_id':m['request_id'],'subtype':'success','response':{'rate_limits':{'five_hour':{'utilization':35},'seven_day':{'utilization':59},'model_scoped':[{'display_name':'Fable','utilization':88}]}}}}),flush=True)
''');path.chmod(0o755)
            self.assertEqual(c.query_codex({'codex':str(path)})['codex_week']['remaining'],32)
            self.assertEqual(c.query_claude({'claude':str(path)})['claude_week']['remaining'],41)

if __name__=='__main__': unittest.main()
