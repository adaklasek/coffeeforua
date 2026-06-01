#!/usr/bin/env python3
"""
BRAVE BREW - Counter Update
Pouziti: python3 update_counter.py <pocet_expedovanych_balicku>
Priklad: python3 update_counter.py 3

Skript aktualizuje pocitadlo na coffeeforua.cz, commitne a deployne.
"""

import sys
import re
import subprocess
import os
from datetime import datetime

REPO = os.path.expanduser('~/Desktop/coffeeforua')
SCRIPT_JS = os.path.join(REPO, 'script.js')


def run(cmd, cwd=REPO):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f'CHYBA: {r.stderr}')
        sys.exit(1)
    return r.stdout.strip()


def update(new_bags_count):
    with open(SCRIPT_JS) as f:
        content = f.read()

    match = re.search(r'const BAGS = (\d+)', content)
    if not match:
        print('Chyba: nenalezeno "const BAGS" v script.js')
        sys.exit(1)

    old_bags = int(match.group(1))
    total_bags = old_bags + new_bags_count

    content = re.sub(r'const BAGS = \d+', f'const BAGS = {total_bags}', content)

    with open(SCRIPT_JS, 'w') as f:
        f.write(content)

    donated_total = total_bags * 100
    donated_new   = new_bags_count * 100

    print(f'Balicky: {old_bags} -> {total_bags}  (+{new_bags_count})')
    print(f'Na Koridor.ua: {donated_total} Kc celkem  (+{donated_new} Kc)')

    run(['git', 'add', 'script.js'])
    run(['git', 'commit', '-m',
         f'Counter: {total_bags} bags sold, {donated_total} Kc donated to Koridor.ua'])
    run(['git', 'push', 'origin', 'main'])

    print(f'Deployed: coffeeforua.cz aktualizovano')
    print(f'Nezapomen poslat {donated_new} Kc na Koridor.ua!')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Pouziti: python3 update_counter.py <pocet>')
        sys.exit(1)

    try:
        count = int(sys.argv[1])
    except ValueError:
        print('Pocet musi byt cislo')
        sys.exit(1)

    update(count)
