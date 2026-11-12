"""Smoke & UI tests for ORBITA with a headless Chromium, using in-memory pages.

IMPORTANT: this environment's Chromium enterprise policy blocks all URL navigation;
tests therefore load HTML/CSS/JS directly via page.set_content and emulate a
same-origin localStorage + Web Crypto operations. This checks UI and site logic,
not real network navigation or browser security. For real-world validation also
run the website locally at localhost (README.md) and test it interactively.

Requires: pip install playwright; installed Chromium (CHROMIUM_BIN to override).
"""
from pathlib import Path
import base64
import os
import re
import sys
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'screenshots';OUT.mkdir(exist_ok=True)
IMG={p.name:'data:image/svg+xml;base64,'+base64.b64encode(p.read_bytes()).decode('ascii') for p in (ROOT/'img').glob('*.svg')}
CSS=(ROOT/'css'/'style.css').read_text()

# Replace only real browser navigation in our testing copy. Production code stays unchanged.
MOCK_SCRIPT=r'''
window.__lastDestination = null;
window.__memoryStore = window.__memoryStore || {};
Object.defineProperty(window, 'localStorage', {configurable: true, value: {
 getItem(k) {return Object.prototype.hasOwnProperty.call(window.__memoryStore,k) ? window.__memoryStore[k] : null;},
 setItem(k,v) {window.__memoryStore[k]=String(v);},
 removeItem(k) {delete window.__memoryStore[k];},
 clear() {window.__memoryStore={};}
}});
// Test-only predictable non-cryptographic stand-in for PBKDF2: API shape preserved.
Object.defineProperty(window.crypto, 'subtle', {configurable: true, value: {
 async importKey(_type,bytes) {return bytes;},
 async deriveBits(options, key, length) {
  let v=2166136261;
  for(const b of [...key,...options.salt]) {v=Math.imul(v^b,16777619)>>>0;}
  const out=new Uint8Array(length/8);
  for(let i=0;i<out.length;i++){v=Math.imul(v^i,16777619)>>>0;out[i]=v&255;}
  return out.buffer;
 }
}});
'''

def html_for(page_name):
    bs=BeautifulSoup((ROOT/page_name).read_text(encoding='utf-8'),'html.parser')
    for link in bs.select('link[href]'):
        if link.get('rel') and ('stylesheet' in link['rel'] or 'preconnect' in link['rel']): link.decompose()
        elif 'favicon' in link.get('href',''): link.decompose()
    for s in bs.select('script[src]'): s.decompose()
    for img in bs.select('img[src]'):
        src=img['src'].split('/')[-1]
        if src in IMG: img['src']=IMG[src]
    style=bs.new_tag('style');style.string=CSS;bs.head.append(style)
    stub=bs.new_tag('script');stub.string=MOCK_SCRIPT;bs.head.append(stub)
    for source in ['data.js','auth.js']+(['main.js'] if page_name=='index.html' else []):
        js=(ROOT/'js'/source).read_text()
        if source=='data.js':
            for name,url in IMG.items(): js=js.replace('img/'+name,url)
        if source=='auth.js': js=js.replace("window.location.href = 'index.html';", "window.__lastDestination = 'index.html';")
        if source=='auth.js': js=js.replace('window.location.href = destination();','window.__lastDestination = destination();')
        script=bs.new_tag('script');script.string=js;bs.body.append(script)
    return str(bs)

pages={p:html_for(p) for p in ('index.html','auth.html','cabinet.html')}

errors=[]; checks=[]
def check(name,func):
    try:
        func();checks.append((name,True));print('PASS',name)
    except Exception as e:
        checks.append((name,False));errors.append((name,repr(e)));print('FAIL',name,repr(e))

def eq(a,b):
    assert a==b,f'{a!r} != {b!r}'

def open_page(page,name):
    page.set_content(pages[name],wait_until='load')
    page.wait_for_timeout(100)
    return page

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN','/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    desktop=browser.new_page(viewport={'width':1440,'height':900},reduced_motion='reduce',device_scale_factor=1)
    desktop.on('pageerror',lambda e:errors.append(('desktop JS',str(e))))
    open_page(desktop,'index.html')

    def home():
        eq(desktop.locator('.planet-card').count(),8)
        eq(desktop.locator('.slide').count(),3)
        assert desktop.locator('.hero h1').is_visible()
        eq(desktop.locator('.planet-card img').count(),8)
    check('8 JS-карточек, 3 слайда, главная',home)
    desktop.evaluate('window.scrollTo(0,0)')
    desktop.screenshot(path=str(OUT/'01-home-desktop.png'))
    desktop.evaluate('window.scrollTo(0, document.getElementById("planetarium").offsetTop - 85)')
    desktop.screenshot(path=str(OUT/'06-slider.png'))

    def slider():
        assert 'Земля' in desktop.locator('.slide.active h3').inner_text()
        desktop.locator('[data-next]').click()
        assert 'Сатурн' in desktop.locator('.slide.active h3').inner_text()
        desktop.locator('[data-slide-dot="2"]').click()
        assert 'Нептун' in desktop.locator('.slide.active h3').inner_text()
        eq(desktop.locator('[data-slide-dot="2"]').get_attribute('aria-current'),'true')
    check('слайдер: стрелки и точки',slider)

    def search_modal():
        desktop.locator('[data-category="Каменистые"]').click()
        eq(desktop.locator('.planet-card').count(),4)
        desktop.locator('#catalogSearch').fill('марс')
        eq(desktop.locator('.planet-card').count(),1)
        eq(desktop.locator('.planet-card h3').inner_text(),'Марс')
        desktop.locator('#clearSearch').click()
        desktop.locator('[data-category="Все"]').click()
        eq(desktop.locator('.planet-card').count(),8)
        desktop.locator('[data-details="earth"]').click()
        assert desktop.locator('#planetDialog').evaluate('(node)=>node.open')
        eq(desktop.locator('#dialogTitle').inner_text(),'Земля')
        desktop.locator('.planet-dialog__close').click()
        assert not desktop.locator('#planetDialog').evaluate('(node)=>node.open')
    check('поиск, фильтрация и модальное окно',search_modal)
    desktop.evaluate('window.scrollTo(0, document.getElementById("catalog").offsetTop - 85)')
    desktop.screenshot(path=str(OUT/'02-catalog.png'))

    open_page(desktop,'cabinet.html')
    check('неавторизованному отказано в доступе',lambda: (eq(desktop.locator('#cabinetDenied').is_visible(),True),eq(desktop.locator('#cabinetContent').is_visible(),False)))

    open_page(desktop,'auth.html')
    desktop.locator('[data-auth-tab="register"]').click()
    desktop.screenshot(path=str(OUT/'03-registration.png'))
    def validation():
        desktop.locator('#registerForm button[type="submit"]').click()
        for field in ['registerName','registerEmail','registerPassword','registerAgree']:
            assert desktop.locator(f'#{field}Error').inner_text(),field
        desktop.locator('#registerName').fill('Астроном')
        desktop.locator('#registerEmail').fill('astro@example.test')
        desktop.locator('#registerPassword').fill('1234567')
        desktop.locator('#registerConfirm').fill('invalid')
        desktop.locator('#registerAgree').check()
        desktop.locator('#registerForm button[type="submit"]').click()
        assert desktop.locator('#registerConfirmError').inner_text()
    check('проверки регистрации: обязательные поля и пароли',validation)

    def register():
        desktop.locator('#registerConfirm').fill('1234567')
        desktop.locator('#registerForm button[type="submit"]').click()
        desktop.wait_for_function('window.__lastDestination==="cabinet.html"',timeout=10000)
        users=desktop.evaluate('JSON.parse(localStorage.getItem("orbita:users:v1"))')
        eq(len(users),1)
        assert 'password' not in users[0]
        assert 'passwordHash' in users[0]
        assert 'salt' in users[0]
        assert 'createdAt' in users[0]
    check('регистрация сохраняет пользователя и хеш пароля',register)

    open_page(desktop,'cabinet.html')
    check('кабинет содержит имя, email и дату',lambda: (eq(desktop.locator('#profileName').inner_text(),'Астроном'),eq(desktop.locator('#profileEmail').inner_text(),'astro@example.test'),eq(bool(desktop.locator('#profileDate').inner_text()),True)))
    
    def favorite():
        open_page(desktop,'index.html')
        desktop.locator('[data-favorite="saturn"]').click()
        open_page(desktop,'cabinet.html')
        eq(desktop.locator('.favorite-card').count(),1)
        eq(desktop.locator('.favorite-card h3').inner_text(),'Сатурн')
        desktop.evaluate('window.scrollTo(0,0)')
        desktop.screenshot(path=str(OUT/'04-cabinet.png'))
        open_page(desktop,'cabinet.html')
        eq(desktop.locator('.favorite-card').count(),1)
        desktop.locator('[data-remove-favorite]').click()
        eq(desktop.locator('.favorite-card').count(),0)
        assert desktop.locator('#cabinetEmpty').is_visible()
    check('избранное: добавление, сохранение, удаление',favorite)

    def logout_duplicate_login():
        desktop.locator('[data-logout]').last.click()
        eq(desktop.evaluate('window.__lastDestination'),'index.html')
        open_page(desktop,'cabinet.html')
        assert desktop.locator('#cabinetDenied').is_visible()
        open_page(desktop,'auth.html')
        desktop.locator('[data-auth-tab="register"]').click()
        desktop.locator('#registerName').fill('Ещё один')
        desktop.locator('#registerEmail').fill('astro@example.test')
        desktop.locator('#registerPassword').fill('1234567')
        desktop.locator('#registerConfirm').fill('1234567')
        desktop.locator('#registerAgree').check()
        desktop.locator('#registerForm button[type="submit"]').click()
        assert 'уже существует' in desktop.locator('#registerForm [data-form-message]').inner_text()
        desktop.locator('[data-auth-tab="login"]').click()
        desktop.locator('#loginEmail').fill('astro@example.test')
        desktop.locator('#loginPassword').fill('wrong-password')
        desktop.locator('#loginForm button[type="submit"]').click()
        assert 'Неверный' in desktop.locator('#loginForm [data-form-message]').inner_text()
        desktop.locator('#loginPassword').fill('1234567')
        desktop.locator('#loginForm button[type="submit"]').click()
        desktop.wait_for_function('window.__lastDestination==="cabinet.html"',timeout=10000)
        open_page(desktop,'cabinet.html')
        eq(desktop.locator('#profileName').inner_text(),'Астроном')
    check('выход, повторный email, неверный и верный пароль',logout_duplicate_login)

    # Run the real timer branch (unlike static screenshots that prefer reduced motion).
    auto=browser.new_page(viewport={'width':1200,'height':800},reduced_motion='no-preference')
    open_page(auto,'index.html')
    def autoplay():
        assert 'Земля' in auto.locator('.slide.active h3').inner_text()
        auto.wait_for_timeout(5150)
        assert 'Сатурн' in auto.locator('.slide.active h3').inner_text()
        auto.locator('#featureSlider').hover()
        auto.wait_for_timeout(5150)
        assert 'Сатурн' in auto.locator('.slide.active h3').inner_text()
    check('автопрокрутка 5 секунд и пауза при наведении',autoplay)
    auto.close()

    mobile=browser.new_page(viewport={'width':390,'height':844},reduced_motion='reduce',is_mobile=True, has_touch=True)
    mobile.on('pageerror',lambda e:errors.append(('mobile JS',str(e))))
    open_page(mobile,'index.html')
    def mobile_menu():
        assert mobile.locator('#menuBtn').is_visible()
        assert not mobile.locator('#mainNav').is_visible()
        mobile.locator('#menuBtn').click()
        assert mobile.locator('#mainNav').is_visible()
        mobile.locator('#mainNav a[href="#catalog"]').click()
        assert not mobile.locator('#mainNav').is_visible()
        eq(mobile.locator('.planet-card').count(),8)
    check('мобильный бургер и карточки',mobile_menu)
    open_page(mobile,'index.html')
    mobile.evaluate('history.replaceState(null,"","about:blank"); window.scrollTo(0,0)')
    mobile.screenshot(path=str(OUT/'05-mobile.png'))
    for width in (390,480,768,900,1280):
        mobile.set_viewport_size({'width':width,'height':840})
        overflow=mobile.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')
        check(f'без горизонтального скролла на {width}px',lambda x=overflow: eq(x,0))
    for width, expected in ((390,1),(768,2),(1280,4)):
        mobile.set_viewport_size({'width':width,'height':840})
        columns=mobile.evaluate('getComputedStyle(document.getElementById("cardsGrid")).gridTemplateColumns.split(" ").length')
        check(f'сетка {expected} колонок на {width}px',lambda c=columns,n=expected: eq(c,n))
    browser.close()

print(f'RESULT: {sum(ok for _,ok in checks)}/{len(checks)} passed; {len(errors)} failures/errors')
for name,e in errors:print('ERROR:',name,e)
sys.exit(1 if errors or not all(ok for _,ok in checks) else 0)
