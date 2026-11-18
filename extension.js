import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const GROUPS = [['Codex', [['codex_5h','5시간'],['codex_week','주간']]], ['Claude Code', [['claude_5h','5시간'],['claude_week','주간 전체']]]];
const WIDTH = 252;
const POLL_SECONDS = 60;
const THEME_NAMES = {auto:'시스템 설정',dark:'다크',light:'라이트'};
const THEME_PATH = GLib.build_filenamev([GLib.get_user_config_dir(),'ai-usage-monitor','theme']);
function countdown(t) {
    if (!Number.isFinite(t)) return '초기화 시간 미제공';
    let s = Math.floor(t - Date.now()/1000);
    if (s <= 0) return '초기화 예정 시각 경과 · 재조회 필요';
    const d=Math.floor(s/86400); s%=86400;
    const h=Math.floor(s/3600); s%=3600;
    const m=Math.floor(s/60); s%=60;
    const pad=n=>String(n).padStart(2,'0');
    return `${d ? d+'일 ' : ''}${pad(h)}:${pad(m)}:${pad(s)}`;
}
function color(p,dark) {return dark ? (p>=50?'#52c99a':p>=20?'#e5b85c':'#ee717b') : (p>=50?'#087e55':p>=20?'#916000':'#b42335');}
function valid(row) {return row && Number.isFinite(row.remaining);}
function expired(row) {return Number.isFinite(row?.reset_at) && row.reset_at <= Date.now()/1000;}
function label(text, style_class='') {return new St.Label({text,style_class,y_align:Clutter.ActorAlign.CENTER});}

export default class UsageMonitor extends Extension {
    enable() {
        this._active=true; this._data={rows:{},errors:{}}; this._rows={}; this._groups={}; this._panelGroups={}; this._lastRequest=0;
        this._button=new PanelMenu.Button(0.5,'AI Usage Monitor',false);
        const panel=new St.BoxLayout({style_class:'aum-panel',y_align:Clutter.ActorAlign.CENTER});
        this._panelDemo=label('DEMO'); this._panelDemo.hide(); panel.add_child(this._panelDemo);
        this._panelCodex=label('—'); this._panelClaude=label('—');
        for (const [provider,icon,value] of [['codex','codex',this._panelCodex],['claude','claude-code',this._panelClaude]]) {
            const part=new St.BoxLayout({style_class:'aum-panel',y_align:Clutter.ActorAlign.CENTER});
            part.add_child(this._providerIcon(icon,18)); part.add_child(value);
            this._panelGroups[provider]=part;
            panel.add_child(part);
            if (provider==='codex') {
                this._panelDivider=label('·','aum-panel-divider'); panel.add_child(this._panelDivider);
            }
        }
        this._panelEmpty=label('AI'); this._panelEmpty.hide(); panel.add_child(this._panelEmpty);
        this._button.add_child(panel);
        const card=new PopupMenu.PopupBaseMenuItem({reactive:false,can_focus:false});
        const box=new St.BoxLayout({vertical:true,style_class:'aum-card'}); card.add_child(box);
        box.add_child(label('AI Usage Monitor','aum-title'));
        for (const [group, items] of GROUPS) {
            const provider=group==='Codex'?'codex':'claude';
            const section=new St.BoxLayout({vertical:true,style_class:'aum-section'});
            this._groups[provider]=section; box.add_child(section);
            const header=new St.BoxLayout({style_class:'aum-group'});
            header.add_child(this._providerIcon(group==='Codex'?'codex':'claude-code',22));
            header.add_child(label(group)); section.add_child(header);
            for (const [key,name] of items) {
                const row=new St.BoxLayout({vertical:true,style_class:'aum-row'});
                const heading=new St.BoxLayout();
                const title=label(name); title.x_expand=true; heading.add_child(title);
                const pct=label('—','aum-percent'); heading.add_child(pct); row.add_child(heading);
                const track=new St.Widget({style_class:'aum-track',width:WIDTH,height:7,layout_manager:new Clutter.FixedLayout()});
                const fill=new St.Widget({height:7,width:0,style:'border-radius: 4px;'}); track.add_child(fill); row.add_child(track);
                const timer=label('조회 중…','aum-muted'); row.add_child(timer); section.add_child(row);
                this._rows[key]={pct,fill,timer};
            }
            const error=label('','aum-error'); error.hide(); section.add_child(error); this[`_error_${group==='Codex'?'codex':'claude'}`]=error;
        }
        this._empty=label('CLI를 설치하고 구독 계정으로 로그인하세요.','aum-muted'); this._empty.hide(); box.add_child(this._empty);
        this._footer=label('조회 중…','aum-muted'); box.add_child(this._footer);
        this._button.menu.addMenuItem(card);
        this._refreshItem=this._button.menu.addAction('지금 새로고침',()=>this._refresh());
        this._themeMenu=new PopupMenu.PopupSubMenuMenuItem('테마');
        this._button.menu.addMenuItem(this._themeMenu);
        for (const mode of ['auto','dark','light'])
            this._themeMenu.menu.addAction(THEME_NAMES[mode],()=>this._setTheme(mode));
        this._interfaceSettings=new Gio.Settings({schema_id:'org.gnome.desktop.interface'});
        this._themeMode='auto';
        try {
            const [ok,bytes]=GLib.file_get_contents(THEME_PATH);
            const mode=new TextDecoder().decode(bytes).trim();
            if(ok && Object.hasOwn(THEME_NAMES,mode)) this._themeMode=mode;
        } catch(e) { /* first installation */ }
        this._themeSignal=this._interfaceSettings.connect('changed::color-scheme',()=>this._applyTheme());
        this._applyTheme();
        Main.panel.addToStatusArea(this.uuid,this._button,0,'right');
        this._tick=GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,1,()=>{this._render();return GLib.SOURCE_CONTINUE;});
        this._poll=GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,POLL_SECONDS,()=>{this._refresh();return GLib.SOURCE_CONTINUE;});
        this._refresh();
    }
    _providerIcon(name,size) {
        return new St.Icon({gicon:new Gio.FileIcon({file:Gio.File.new_for_path(`${this.path}/icons/${name}.svg`)}),icon_size:size,y_align:Clutter.ActorAlign.CENTER});
    }
    _setTheme(mode) {
        if(!Object.hasOwn(THEME_NAMES,mode)) return;
        this._themeMode=mode;
        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(THEME_PATH),0o700);
            GLib.file_set_contents(THEME_PATH,`${mode}\n`);
        } catch(e) { console.error(`AI Usage Monitor: theme save failed: ${e.message}`); }
        this._applyTheme();
    }
    _applyTheme() {
        this._dark=this._themeMode==='dark'||(this._themeMode==='auto'&&this._interfaceSettings.get_string('color-scheme')==='prefer-dark');
        const actor=this._button.menu.actor;
        actor.remove_style_class_name('aum-dark'); actor.remove_style_class_name('aum-light');
        actor.add_style_class_name(this._dark?'aum-dark':'aum-light');
        this._themeMenu.label.text=`테마: ${THEME_NAMES[this._themeMode]}`;
        this._render();
    }
    _refresh() {
        if (!this._active || this._process || Date.now()-this._lastRequest<30000) return;
        this._lastRequest=Date.now();
        this._footer.text='사용량 조회 중…';
        try {
            const proc=Gio.Subprocess.new(['/usr/bin/python3',`${this.path}/collector.py`],Gio.SubprocessFlags.STDOUT_PIPE|Gio.SubprocessFlags.STDERR_PIPE);
            this._process=proc;
            proc.communicate_utf8_async(null,null,(p,res)=>{
                try {
                    const [,output]=p.communicate_utf8_finish(res);
                    if (!this._active || this._process!==p) return;
                    if (!p.get_successful()) throw new Error('collector failed');
                    this._data=JSON.parse(output); this._failed=false;
                } catch(e) {
                    if (this._active && this._process===p) {this._failed=true; for (const row of Object.values(this._data.rows||{})) if (row) row.stale=true;}
                } finally {
                    if (this._active && this._process===p) {this._process=null;this._render();}
                }
            });
        } catch(e) {this._process=null;this._failed=true;this._render();}
    }
    _render() {
        if (!this._active) return;
        const data=this._data; const compact=k=>{const r=data.rows?.[k];return valid(r)&&!expired(r)?`${r.stale?'~':''}${Math.round(r.remaining)}%`:'—';};
        const known=Boolean(data.providers);
        const codex=!known || data.providers.codex===true;
        const claude=!known || data.providers.claude===true;
        this._panelGroups.codex.visible=codex; this._panelGroups.claude.visible=claude;
        this._groups.codex.visible=codex; this._groups.claude.visible=claude;
        this._panelDivider.visible=codex&&claude;
        this._panelEmpty.visible=!codex&&!claude; this._empty.visible=!codex&&!claude;
        this._panelDemo.visible=Boolean(data.demo);
        this._panelCodex.text=compact('codex_5h'); this._panelClaude.text=compact('claude_5h');
        for (const [key, ui] of Object.entries(this._rows)) {
            const row=data.rows?.[key]; const ok=valid(row); const past=expired(row);
            ui.pct.text=ok&&!past?`${row.stale?'~':''}${row.remaining}% 남음`:'—';
            ui.pct.set_style(`color: ${ok&&!past?color(row.remaining,this._dark):(this._dark?'#aaaaaa':'#666666')};`);
            ui.fill.width=ok&&!past?Math.round(WIDTH*row.remaining/100):0;
            ui.fill.set_style(`background-color: ${ok?color(row.remaining,this._dark):'transparent'}; border-radius: 4px;`);
            ui.timer.text=ok?`${row.stale?'이전 값 · ':''}${!Number.isFinite(row.reset_at) && row.active === false ? '타이머 미시작' : countdown(row.reset_at)}`:'한도 데이터 없음';
        }
        for (const provider of ['codex','claude']) {
            const e=this[`_error_${provider}`]; const msg=data.errors?.[provider];
            e.text=msg||''; e.visible=Boolean(msg);
        }
        const time=data.checked_at?new Date(data.checked_at*1000).toLocaleTimeString():'—';
        this._footer.text=this._process?'사용량 조회 중…':this._failed?'수집기 실행 실패 · 이전 값':!codex&&!claude?'CLI 미설치 · 1분마다 자동 탐색':`${data.demo?'데모 · ':''}마지막 조회 ${time} · 1분 간격`;
    }
    disable() {
        this._active=false;
        if(this._themeSignal) this._interfaceSettings.disconnect(this._themeSignal);
        this._themeSignal=0; this._interfaceSettings=null;
        if(this._tick) GLib.Source.remove(this._tick);
        if(this._poll) GLib.Source.remove(this._poll);
        // Let in-flight CLI finish gracefully, particularly during auth renewal.
        this._process=null; this._button?.destroy();this._button=null;this._rows={};
    }
}
