# Which production sailings did the robot stamp FULL while a rider's "not yet"
# had cleared the crosswalk mark? Replays the full-call gate at the moment of
# each stamp (frame dt[-4]) from the public aggregate + lineupReports.
# Read-only against production. Write-up:
#   docs/experiments/2026-10-17-full-gate-refuted-detection.md
#   python3 -I scripts/experiments/full-gate-refuted-detection-scan.py > affected.json
import json, urllib.request, datetime, sys
BASE="https://firestore.googleapis.com/v1/projects/bowen-ferry/databases/(default)/documents"
def get(url):
    return json.load(urllib.request.urlopen(url))
def runq(body):
    req=urllib.request.Request(BASE+":runQuery", data=json.dumps(body).encode(), headers={'Content-Type':'application/json'})
    return json.load(urllib.request.urlopen(req))
def val(v):
    if v is None: return None
    k=list(v.keys())[0]; x=v[k]
    if k=='integerValue': return int(x)
    if k=='arrayValue': return [val(y) for y in x.get('values',[])]
    if k=='mapValue': return {kk:val(vv) for kk,vv in x.get('fields',{}).items()}
    return x
def fmt(ms):
    return datetime.datetime.fromtimestamp(ms/1000, datetime.timezone(datetime.timedelta(hours=-7))).strftime('%H:%M:%S')
agg=get(BASE+"/aggregates/bowenSailings")
recs=[{k:val(v) for k,v in r['mapValue']['fields'].items()} for r in agg['fields']['sailings']['arrayValue']['values']]
full=[r for r in recs if r.get('fl')]
print('sailings on record', len(recs), '| robot full stamps (fl)', len(full), file=sys.stderr)
affected=[]
for r in full:
    key=f"{r['d']}_{r['t']}_To HSB"
    dt=r.get('dt') or []
    if len(dt)<4: continue
    stamp_ts=dt[-4]  # the frame that completes the final 4-cars run
    res=runq({"structuredQuery":{"from":[{"collectionId":"lineupReports"}],"where":{"fieldFilter":{"field":{"fieldPath":"sailingKey"},"op":"EQUAL","value":{"stringValue":key}}},"limit":50}})
    reports=[{k:val(v) for k,v in d['document']['fields'].items()} for d in res if d.get('document')]
    reports=[x for x in reports if x.get('userUid') and (x.get('notYet') or isinstance(x.get('crosswalkAt'),int))]
    reports.sort(key=lambda x:x.get('recordedAt') or 0)
    before=[x for x in reports if (x.get('recordedAt') or 0) <= stamp_ts]
    latest=before[-1] if before else None
    # Effective mark at stamp time: latest rider word if any, else robot detection (if it had been confirmed by then).
    cwa=r.get('cwa')
    if latest:
        mark_at_stamp = None if latest.get('notYet') else latest['crosswalkAt']
    else:
        mark_at_stamp = cwa if (cwa is not None and cwa <= stamp_ts) else None
    old_gate = (cwa is not None and cwa <= stamp_ts) or mark_at_stamp is not None
    new_gate = mark_at_stamp is not None
    row={'key':key,'d':r['d'],'t':r['t'],'cwa':cwa,'cw':r.get('cw'),'stamp_frame':stamp_ts,'dt_tail':dt[-4:],'reports':[(x.get('userName'),'notYet' if x.get('notYet') else fmt(x['crosswalkAt']),fmt(x['recordedAt'])) for x in reports],'old':old_gate,'new':new_gate,'cap':r.get('cap'),'src':r.get('src')}
    if old_gate!=new_gate: affected.append(row)
print(json.dumps(affected, indent=1))
print('affected', len(affected), file=sys.stderr)
for a in affected:
    print(f"{a['d']} {a['t']} detection {fmt(a['cwa']) if a['cwa'] else '-'} | stamp frame {fmt(a['stamp_frame'])} | reports {a['reports']} | now cap={a['cap']}/{a['src']}", file=sys.stderr)
