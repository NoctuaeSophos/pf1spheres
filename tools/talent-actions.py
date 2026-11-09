# SPDX-FileCopyrightText: 2026 NoctuaeSophos
#
# SPDX-License-Identifier: EUPL-1.2

"""Give Spheres talents pf1 actions from their descriptions: activation, save, duration, spell point cost.

usage: python3 tools/talent-actions.py REPO [--write] [--sample N] [--only NAME ...]
Only talents whose actions list is empty are touched. Writes YAML in place with --write.
"""
import glob, html, json, random, re, string, sys, collections
import yaml

REPO = sys.argv[1]
WRITE = "--write" in sys.argv
SAMPLE = int(sys.argv[sys.argv.index("--sample") + 1]) if "--sample" in sys.argv else 0
ONLY = [a for a in sys.argv[sys.argv.index("--only") + 1:] if not a.startswith("--")] if "--only" in sys.argv else []
PACKS = sys.argv[sys.argv.index("--packs") + 1].split(",") if "--packs" in sys.argv else ["magic-talents", "combat-talents", "skill-talents"]

ACT_WORDS = {"standard": "standard", "move": "move", "swift": "swift", "immediate": "immediate", "free": "free", "full-round": "full", "full round": "full"}
UNCHAINED = {"standard": (2, "action"), "move": (1, "action"), "swift": (1, "action"), "immediate": (1, "reaction"), "free": (1, "free"), "full": (3, "action")}
ACT = re.compile(r"\b(?:as|is|takes?|requires?|using|with|for|spends?|spending|uses?)\s+(?:a|an|one|your)\s+(standard|move|swift|immediate|free|full[- ]round)\s+action", re.I)
OTHER_SUBJECT = re.compile(r"\b(creatures?|targets?|ally|allies|enemy|enemies|it|they|he|she|the subject|foes?|opponents?)\s+(?:can|may|must|might|could)\b", re.I)
SAVE = re.compile(r"\b(Will|Reflex|Fortitude|Fort)\s+(negates|half|partial|save|saving throw|ends|disbelief)\b(?:\s+(negates|half|partial|ends))?", re.I)
SP = re.compile(r"spend(?:ing|s)?\s+(an additional|additional|a|one|two|three|\d+)\s+(?:additional\s+|more\s+)?spell points?", re.I)
NUM = {"a": 1, "one": 1, "an additional": 1, "additional": 1, "two": 2, "three": 3}
TOUCH = re.compile(r"\b(melee|ranged) touch attack", re.I)
DUR_CL = re.compile(r"\b(?:for\s+)?(\d+|one|ten)\s+(round|minute|hour|day)s?\s+per\s+caster\s+level", re.I)
DUR_FIX = re.compile(r"\bfor\s+(\d+|one|two|three|ten)\s+(round|minute|hour)s?\b", re.I)
SAVE_TYPE = {"will": "will", "reflex": "ref", "fortitude": "fort", "fort": "fort"}
WORDNUM = {"one": 1, "two": 2, "three": 3, "ten": 10}
USE_OPENING = re.compile(r"^(You (?:may|can|must|create|gain the ability|summon|make|choose)|As (?:a|an)\b|By spending|Spend|The (?:target|subject)|Targets?\b|A target|Creatures? (?:within|in)|You and)", re.I)
PREREQ = re.compile(r"^Prerequisites?:", re.I)
GATED = re.compile(r"^(when|whenever|if|while|once|each time|after)\b", re.I)

def load(f): return yaml.load(open(f), Loader=yaml.CSafeLoader)
def text(d): return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", d["system"]["description"]["value"] or ""))).strip()
def sentences(t): return [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z(])", t) if s.strip()]
def new_id(): return "".join(random.choice(string.ascii_letters + string.digits) for _ in range(16))

def own_activation(sents):
    for s in sents:
        for m in ACT.finditer(s):
            before = s[: m.start()]
            if "you" not in s.lower(): continue
            if OTHER_SUBJECT.search(before): continue
            return ACT_WORDS[m.group(1).lower().replace("–", "-")], s
    return None, None

def build(d, pack):
    t = text(d)
    sents = sentences(t)
    sphere = (d.get("flags", {}).get("pf1spheres") or {}).get("sphere") or ""
    magic = pack == "magic-talents" or (STRICT and KINDS.get(sphere) == "magic")
    act, act_sent = own_activation(sents)
    save = SAVE.search(t)
    sps = [(m, s) for s in sents for m in SP.finditer(s)]
    touch = TOUCH.search(t)
    if not (act or save or (magic and sps)):
        return None, None
    if STRICT and not act:
        return None, None
    if not act:
        # Without a stated action, only something that reads like an ability you use gets one
        opening = next((x for x in sents if not PREREQ.search(x)), "")
        if magic and not USE_OPENING.search(opening):
            return None, None
        act = "standard" if magic else "special"
    a = {"_id": new_id(), "name": d["name"], "actionType": "other", "activation": {"type": act}}
    if act in UNCHAINED:
        cost, kind = UNCHAINED[act]
        a["activation"]["unchained"] = {"cost": cost, "type": kind}
    if touch:
        a["actionType"] = "msak" if touch.group(1).lower() == "melee" else "rsak"
        a["touch"] = True
        a["ability"] = {"attack": "str" if a["actionType"] == "msak" else "dex"}
    if save and not (STRICT and not KINDS.get(sphere)):
        kind = SAVE_TYPE[save.group(1).lower()]
        effect = (save.group(3) or save.group(2)).lower()
        dc = (f"10 + floor(@spheres.cl.{sphere}.total / 2) + @spheres.cam" if magic and sphere
              else "10 + floor(@spheres.cl.total / 2) + @spheres.cam" if magic
              else "10 + floor(@attributes.bab.total / 2) + @spheres.pam")
        a["save"] = {"type": kind, "dc": dc, "description": f"{save.group(1).title()} {effect}" if effect not in ("save", "saving throw") else ""}
        if a["actionType"] == "other": a["actionType"] = "save"
    m = DUR_CL.search(t)
    if m:
        n = WORDNUM.get(m.group(1).lower(), None) or int(m.group(1))
        cl = f"@spheres.cl.{sphere}.total" if magic and sphere else "@spheres.cl.total" if magic else "@attributes.bab.total"
        a["duration"] = {"value": cl if n == 1 else f"{n} * {cl}", "units": m.group(2).lower()}
    else:
        m = DUR_FIX.search(t)
        if m:
            n = WORDNUM.get(m.group(1).lower(), None) or int(m.group(1))
            a["duration"] = {"value": str(n), "units": m.group(2).lower()}
    auto, conds, seen = {}, [], set()
    for m, s in sps:
        n = NUM.get(m.group(1).lower(), None) or int(m.group(1))
        extra = "additional" in m.group(0).lower() or "more" in m.group(0).lower()
        required = not extra and not GATED.search(s)
        # One required cost at most, and one optional box per amount
        key = "required" if required else ("option", n)
        if key in seen: continue
        seen.add(key)
        cid = new_id()
        conds.append({"_id": cid, "name": f"Spend {n} spell point{'s' if n > 1 else ''}" + ("" if required else " (option)"), "default": required, "modifiers": []})
        auto.setdefault("condSp", {})[cid] = n
        if len(conds) >= 3: break
    if conds: a["conditionals"] = conds
    return a, auto

def block(obj, indent):
    """YAML for obj, every line indented, so it can be spliced into a file without reformatting the rest."""
    text = yaml.dump(obj, sort_keys=False, allow_unicode=True, width=100, default_flow_style=False)
    return "".join(" " * indent + line + "\n" for line in text.rstrip("\n").split("\n"))

def write(f, a, auto):
    src = open(f).read()
    assert src.count("\n  actions: []\n") == 1, f
    src = src.replace("\n  actions: []\n", "\n  actions:\n" + block([a], 4), 1)
    if auto:
        entry = block({"automation": {a["_id"]: auto}}, 4)
        if "\n  pf1spheres:\n" in src:
            src = src.replace("\n  pf1spheres:\n", "\n  pf1spheres:\n" + entry, 1)
        else:
            assert src.count("\nflags:\n") == 1, f
            src = src.replace("\nflags:\n", "\nflags:\n  pf1spheres:\n" + entry, 1)
    yaml.load(src, Loader=yaml.CSafeLoader)
    open(f, "w").write(src)

LIMITED = "--limited" in sys.argv
# --strict (feats, features): only a stated action counts, and a save gets a DC only from a known sphere
STRICT = "--strict" in sys.argv

def sphere_kinds():
    """Which sphere keys are magic and which martial, from the talent packs."""
    kinds = {}
    for pack, kind in (("magic-talents", "magic"), ("combat-talents", "combat")):
        for f in glob.glob(f"{REPO}/src/packs/{pack}/*.yaml"):
            k = ((load(f).get("flags") or {}).get("pf1spheres") or {}).get("sphere")
            if k: kinds.setdefault(k, kind)
    return kinds
KINDS = sphere_kinds() if STRICT else {}

def build_limited(d):
    """A plain action for an item with limited uses and none: it spends the item's own charges."""
    t = text(d)
    act, _ = own_activation(sentences(t))
    a = {"_id": new_id(), "name": d["name"], "actionType": "other", "activation": {"type": act or "special"}}
    if act in UNCHAINED:
        cost, kind = UNCHAINED[act]
        a["activation"]["unchained"] = {"cost": cost, "type": kind}
    m = DUR_FIX.search(t)
    if m:
        n = WORDNUM.get(m.group(1).lower(), None) or int(m.group(1))
        a["duration"] = {"value": str(n), "units": m.group(2).lower()}
    return a

def main_limited():
    """--limited: every pack item with limited uses (system.uses.per) and no actions gets one."""
    count = collections.Counter()
    for f in sorted(glob.glob(f"{REPO}/src/packs/*/*.yaml")):
        d = load(f)
        if ONLY and d["name"] not in ONLY: continue
        if "system" not in d or d.get("type") in ("class", "race") or d["system"].get("actions") or not (d["system"].get("uses") or {}).get("per"): continue
        a = build_limited(d)
        count[a["activation"]["type"]] += 1
        print(f"{d['name']}: {a['activation']['type']}" + (f", {a['duration']['value']} {a['duration']['units']}" if "duration" in a else ""))
        if WRITE: write(f, a, None)
    print(dict(count))

def main():
    if LIMITED: return main_limited()
    random.seed(7)
    stats = collections.Counter()
    out = []
    for pack in PACKS:
        for f in sorted(glob.glob(f"{REPO}/src/packs/{pack}/*.yaml")):
            d = load(f)
            if ONLY and d["name"] not in ONLY: continue
            if d["system"].get("actions"): stats["has actions"] += 1; continue
            a, auto = build(d, pack)
            if not a: stats[pack, "none"] += 1; continue
            stats[pack, a["activation"]["type"]] += 1
            stats[pack, "save"] += "save" in a
            stats[pack, "sp"] += bool(auto)
            out.append((f, d, a, auto))
            if WRITE:
                write(f, a, auto)
    for k, v in sorted(stats.items(), key=str): print(k, v)
    picks = out if ONLY else random.sample(out, min(SAMPLE, len(out)))
    for f, d, a, auto in picks:
        print("\n==", d["name"], "|", text(d)[:260])
        print("  ->", json.dumps({k: v for k, v in a.items() if k not in ("_id", "name")}), json.dumps(auto) if auto else "")
main()
