# Browser smoke test over the DEMO seed (fresh DB). Run: pip install playwright && playwright install chromium && python tests/e2e/smoke_demo.py
# Covers owner dashboards, manager count + device enrollment, staff voice(FAKE)->review->confirm, Gujarati UI, logout, partial transfer receipt.
# Screenshots go to /tmp/shots. Needs VOICE_PROVIDER=fake.
import sys
from playwright.sync_api import sync_playwright, expect
import os
B=os.environ.get('STOCKWISE_URL','http://localhost:3000')
errs=[]
with sync_playwright() as p:
    try:
        br=p.chromium.launch(args=['--no-sandbox'])
        # Owner desktop
        ctx=br.new_context(viewport={'width':1440,'height':900}); pg=ctx.new_page(); pg.on('console', lambda m: m.type=='error' and errs.append(m.text))
        pg.goto(B); pg.get_by_role('button',name='Manager / Owner').click()
        pg.get_by_label('Employee code').fill('OWNER'); pg.get_by_label('Password').fill('demo-password-123'); pg.get_by_role('button',name='Sign in').click()
        pg.get_by_text('Available in stores').wait_for(); pg.wait_for_timeout(400); pg.screenshot(path='/tmp/shots/owner_overview.png', full_page=True)
        pg.get_by_role('button',name='Hotels & stock').click(); pg.get_by_text('Store availability').wait_for(); pg.wait_for_timeout(300); pg.screenshot(path='/tmp/shots/owner_matrix.png', full_page=True)
        pg.get_by_role('button',name='Usage').click(); pg.get_by_text('Units placed per day').wait_for(); pg.wait_for_timeout(300); pg.screenshot(path='/tmp/shots/owner_usage.png', full_page=True)
        pg.get_by_role('button',name='Transfers').click(); pg.wait_for_timeout(600); pg.screenshot(path='/tmp/shots/owner_transfers.png', full_page=True)
        pg.get_by_role('button',name='Alerts').click(); pg.wait_for_timeout(600); pg.screenshot(path='/tmp/shots/owner_alerts.png', full_page=True)
        ctx.close()
        # Manager on a phone: enroll device, then staff uses it
        ctx=br.new_context(viewport={'width':390,'height':844}, permissions=[]); pg=ctx.new_page(); pg.on('console', lambda m: m.type=='error' and errs.append(m.text))
        pg.goto(B); pg.get_by_role('button',name='Manager / Owner').click()
        pg.get_by_label('Employee code').fill('MGR1'); pg.get_by_label('Password').fill('demo-password-123'); pg.get_by_role('button',name='Sign in').click()
        pg.get_by_role('heading',name='Weekly verification — Demo Hotel 1').wait_for(); pg.screenshot(path='/tmp/shots/mgr_count_start.png', full_page=True)
        pg.get_by_role('button',name='Start physical count').click(); pg.get_by_text('Physical').first.wait_for(); pg.wait_for_timeout(400)
        inputs=pg.locator('input[aria-label^="Physical"]'); n=inputs.count()
        for i in range(n):
            inputs.nth(i).fill('10' if i==0 else pg.locator('tbody tr').nth(i).locator('td').nth(1).inner_text()); inputs.nth(i).blur()
        pg.wait_for_timeout(500); pg.screenshot(path='/tmp/shots/mgr_count_entry.png', full_page=True)
        pg.get_by_role('button',name='Settings').click(); pg.get_by_role('button',name='Enroll this device for staff').click(); pg.get_by_text('Device enrolled').wait_for()
        pg.get_by_role('button',name='Sign out').click()
        pg.get_by_role('button',name='Sign in').wait_for(); pg.get_by_label('Employee code').fill('S101'); pg.get_by_label('PIN').fill('1234'); pg.get_by_role('button',name='Sign in').click()
        pg.get_by_role('button',name='Start recording').wait_for(); pg.get_by_label('ભાષા').select_option('en'); pg.wait_for_timeout(300); pg.wait_for_timeout(300); pg.screenshot(path='/tmp/shots/staff_speak.png', full_page=True)
        pg.get_by_text('Developer: simulate speech').click(); pg.get_by_placeholder('Room 101 mein 2 soap rakhe').fill('રૂમ ૨૦૩ માં બે સાબુ અને એક શેમ્પૂ મૂક્યા'); pg.get_by_role('button',name='Send').click()
        pg.get_by_role('button',name='Confirm').wait_for(); pg.wait_for_timeout(300); pg.screenshot(path='/tmp/shots/staff_review.png', full_page=True)
        pg.get_by_role('button',name='Confirm').click(); pg.get_by_text('Recorded').first.wait_for(); pg.screenshot(path='/tmp/shots/staff_done.png', full_page=True)
        pg.get_by_role('button',name='Record another').click()
        pg.get_by_label('Language').select_option('gu'); pg.wait_for_timeout(300); pg.screenshot(path='/tmp/shots/staff_gujarati.png', full_page=True)
        pg.get_by_role('button',name='મારો સ્ટોક').click(); pg.wait_for_timeout(500); pg.screenshot(path='/tmp/shots/staff_mystock.png', full_page=True)
        pg.get_by_role('button',name='સાઇન આઉટ').click(); pg.get_by_label('Employee code').wait_for()
        # INV-19 in the browser: after logout the previous staff session is gone
        r=pg.request.get(B+'/api/v1/me'); print('me after logout ->', r.status)
        ctx.close()
        # Hotel 2: manager enrolls, staff receives the pending transfer partially
        ctx=br.new_context(viewport={'width':390,'height':844}); pg=ctx.new_page(); pg.on('console', lambda m: m.type=='error' and errs.append(m.text))
        pg.goto(B); pg.get_by_role('button',name='Manager / Owner').click()
        pg.get_by_label('Employee code').fill('MGR2'); pg.get_by_label('Password').fill('demo-password-123'); pg.get_by_role('button',name='Sign in').click()
        pg.get_by_role('button',name='Settings').click(); pg.get_by_role('button',name='Enroll this device for staff').click(); pg.get_by_text('Device enrolled').wait_for()
        pg.get_by_role('button',name='Sign out').click(); pg.get_by_role('button',name='Sign in').wait_for(); pg.get_by_label('Employee code').fill('S201'); pg.get_by_label('PIN').fill('1234'); pg.get_by_role('button',name='Sign in').click(); pg.wait_for_timeout(1500); pg.screenshot(path='/tmp/shots/dbg.png')
        pg.get_by_role('button',name='Start recording').wait_for(); pg.get_by_label(lambda x: True) if False else None
        pg.locator('#lang').select_option('en'); pg.get_by_role('button',name='Transfers').click()
        pg.get_by_role('textbox',name='Received Dental kit').fill('18'); pg.wait_for_timeout(200)
        pg.screenshot(path='/tmp/shots/staff_receive.png', full_page=True)
        pg.get_by_role('button',name='Confirm received').click(); pg.get_by_text('still in transit').wait_for(); pg.screenshot(path='/tmp/shots/staff_received.png', full_page=True)
        ctx.close()
        br.close()
    except Exception as e:
        pg.screenshot(path='/tmp/shots/fail.png'); print('FAIL', str(e)[:300]); print(pg.locator('body').inner_text()[:600])
print('console errors:', errs)
