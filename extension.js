import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {LANGUAGES, LANGUAGE_MODES, defaultLanguage, translate, translateError, countdown} from './i18n.js';

import {syncMode, toggleMode} from './preferences.js';

const GROUPS = [['Codex', [['codex_5h','fiveHour'],['codex_week','weekly']]], ['Claude Code', [['claude_5h','fiveHour'],['claude_week','weekly']]]];
const WIDTH = 252;
const POLL_SECONDS = 60;
const THEMES = ['auto','dark','light'];
const THEME_PATH = GLib.build_filenamev([GLib.get_user_config_dir(),'ai-usage-monitor','theme']);
const LANGUAGE_PATH = GLib.build_filenamev([GLib.get_user_config_dir(),'ai-usage-monitor','language']);
function color(p,dark) {return dark ? (p>=50?'#52c99a':p>=20?'#e5b85c':'#ee717b') : (p>=50?'#087e55':p>=20?'#916000':'#b42335');}
function valid(row) {return row && Number.isFinite(row.remaining);}
function expired(row) {return Number.isFinite(row?.reset_at) && row.reset_at <= Date.now()/1000;}
function label(text, style_class='') {return new St.Label({text,style_class,y_align:Clutter.ActorAlign.CENTER});}

export default class UsageMonitor extends Extension {
    enable() {
        this._active=true; this._data={rows:{},errors:{}}; this._rows={}; this._groups={}; this._panelGroups={}; this._failed=false; this._process=null;
        this._languageMode='auto';
        try {
            const [ok,bytes]=GLib.file_get_contents(LANGUAGE_PATH);
            const saved=new TextDecoder().decode(bytes).trim();
            if(ok && LANGUAGE_MODES.includes(saved)) this._languageMode=saved;
        } catch(e) { /* first installation */ }
        this._syncLanguage();
        this._button=new PanelMenu.Button(0.5,'AI Usage Monitor',false);
        this._button.menu.box.add_style_class_name('aum-surface');
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
        this._panelEmpty=new St.BoxLayout({style_class:'aum-panel',y_align:Clutter.ActorAlign.CENTER});
        this._panelEmpty.add_child(this._controlIcon('sparkle',16,'dark')); this._panelEmpty.add_child(label('AI'));
        this._panelEmpty.hide(); panel.add_child(this._panelEmpty);
        this._button.add_child(panel);
        const card=new PopupMenu.PopupBaseMenuItem({reactive:false,can_focus:false,style_class:'aum-body-item'});
        const box=new St.BoxLayout({vertical:true,style_class:'aum-card',x_expand:true}); card.add_child(box);
        const top=new St.BoxLayout({style_class:'aum-header',x_expand:true});
        const heading=label('AI Usage Monitor','aum-title'); heading.x_expand=true; top.add_child(heading);
        this._refreshButton=this._iconButton('refresh','refresh',()=>this._refresh());
        this._languageButton=this._iconButton('language','language',()=>this._toggleLanguage());
        this._themeButton=this._iconButton('moon','theme',()=>this._toggleTheme());
        for(const button of [this._refreshButton,this._languageButton,this._themeButton]) top.add_child(button);
        box.add_child(top);
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
                const title=label(this._tr(name)); title.x_expand=true; heading.add_child(title);
                const pct=label('—','aum-percent'); heading.add_child(pct); row.add_child(heading);
                const track=new St.Widget({style_class:'aum-track',width:WIDTH,height:7,layout_manager:new Clutter.FixedLayout()});
                const fill=new St.Widget({height:7,width:0,style:'border-radius: 4px;'}); track.add_child(fill); row.add_child(track);
                const timer=label(this._tr('querying'),'aum-muted'); row.add_child(timer); section.add_child(row);
                this._rows[key]={pct,fill,timer,title,name};
            }
            const error=label('','aum-error'); error.clutter_text.line_wrap=true; error.hide(); section.add_child(error); this[`_error_${provider}`]=error;
            // The separator belongs to its provider: hide both together.
            section.add_child(new St.Widget({style_class:'aum-divider',height:1,x_expand:true,x_align:Clutter.ActorAlign.FILL}));
        }
        this._empty=new St.BoxLayout({vertical:true,style_class:'aum-empty',x_expand:true});
        this._emptyIcon=this._controlIcon('empty-monitor',48);
        this._empty.add_child(this._emptyIcon);
        this._emptyTitle=label(this._tr('noAi'),'aum-empty-title');
        this._emptyTitle.x_align=Clutter.ActorAlign.CENTER;this._empty.add_child(this._emptyTitle);
        this._emptyMessage=label(this._tr('installCli'),'aum-muted');
        this._emptyMessage.clutter_text.line_wrap=true;
        this._emptyMessage.clutter_text.set_line_alignment(1); // Pango.Alignment.CENTER
        this._emptyMessage.x_align=Clutter.ActorAlign.CENTER;this._empty.add_child(this._emptyMessage);
        this._empty.hide();box.add_child(this._empty);
        this._footer=label(this._tr('querying'),'aum-muted'); box.add_child(this._footer);
        this._button.menu.addMenuItem(card);
        this._button.menu.connect('open-state-changed',(_menu,open)=>{if(open){this._syncLanguage();this._applyLanguage();}});
        this._interfaceSettings=new Gio.Settings({schema_id:'org.gnome.desktop.interface'});
        this._themeMode='auto';
        try {
            const [ok,bytes]=GLib.file_get_contents(THEME_PATH);
            const mode=new TextDecoder().decode(bytes).trim();
            if(ok && THEMES.includes(mode)) this._themeMode=mode;
        } catch(e) { /* first installation */ }
        this._themeSignal=this._interfaceSettings.connect('changed::color-scheme',()=>this._applyTheme());
        this._applyTheme();
        this._applyLanguage();
        Main.panel.addToStatusArea(this.uuid,this._button,0,'right');
        this._tick=GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,1,()=>{this._render();return GLib.SOURCE_CONTINUE;});
        this._poll=GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,POLL_SECONDS,()=>{this._refresh();return GLib.SOURCE_CONTINUE;});
        this._refresh();
    }
    _tr(key) { return translate(this._language,key); }
    _saveMode(path, mode) {
        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(path),0o700);
            GLib.file_set_contents(path,mode+'\n');
        } catch(e) { console.error('AI Usage Monitor: preference save failed'); }
    }
    _systemLanguage() { return defaultLanguage(GLib.get_language_names()[0]); }
    _systemTheme() {
        return this._interfaceSettings.get_string('color-scheme')==='prefer-dark'?'dark':'light';
    }
    _syncLanguage() {
        const state=syncMode(this._languageMode,this._systemLanguage());
        if(state.mode!==this._languageMode) this._saveMode(LANGUAGE_PATH,state.mode);
        this._languageMode=state.mode;
        this._language=state.value;
    }
    _toggleLanguage() {
        this._syncLanguage();
        const state=toggleMode(this._language,this._systemLanguage(),'ko','en');
        this._languageMode=state.mode;
        this._language=state.value;
        this._saveMode(LANGUAGE_PATH,state.mode);
        this._applyLanguage();
    }
    _applyLanguage() {
        for (const ui of Object.values(this._rows)) ui.title.text=this._tr(ui.name);
        this._emptyTitle.text=this._tr('noAi');
        this._emptyMessage.text=this._tr('installCli');
        this._refreshButton.accessible_name=this._tr('refresh');
        this._languageButton.accessible_name=this._tr('language')+': '+LANGUAGES[this._language]+(this._languageMode==='auto'?' ('+this._tr('auto')+')':'');
        this._themeButton.accessible_name=this._tr('theme')+': '+this._tr(this._dark?'dark':'light')+(this._themeMode==='auto'?' ('+this._tr('auto')+')':'');
        this._render();
    }
    _iconFile(name,tone) {
        return new Gio.FileIcon({file:Gio.File.new_for_path(`${this.path}/icons/${name}-${tone}.svg`)});
    }
    _controlIcon(name,size=18,tone=this._dark===false?'light':'dark') {
        return new St.Icon({gicon:this._iconFile(name,tone),icon_size:size,style_class:'aum-control-image',x_align:Clutter.ActorAlign.CENTER,y_align:Clutter.ActorAlign.CENTER});
    }
    _iconButton(icon,key,callback) {
        const button=new St.Button({style_class:'aum-icon-button',can_focus:true,accessible_name:this._tr(key),child:this._controlIcon(icon)});
        button.connect('clicked',callback);return button;
    }
    _providerIcon(name,size) {
        return new St.Icon({gicon:new Gio.FileIcon({file:Gio.File.new_for_path(`${this.path}/icons/${name}.svg`)}),icon_size:size,y_align:Clutter.ActorAlign.CENTER});
    }
    _toggleTheme() {
        const state=toggleMode(this._dark?'dark':'light',this._systemTheme(),'dark','light');
        this._themeMode=state.mode;
        this._saveMode(THEME_PATH,state.mode);
        this._applyTheme();
    }
    _applyTheme() {
        const state=syncMode(this._themeMode,this._systemTheme());
        if(state.mode!==this._themeMode) this._saveMode(THEME_PATH,state.mode);
        this._themeMode=state.mode;
        this._dark=state.value==='dark';
        const actor=this._button.menu.actor;
        actor.remove_style_class_name('aum-dark'); actor.remove_style_class_name('aum-light');
        actor.add_style_class_name(this._dark?'aum-dark':'aum-light');
        const tone=this._dark?'dark':'light';
        this._refreshButton.set_child(this._controlIcon('refresh',18,tone));
        this._languageButton.set_child(this._controlIcon('language',18,tone));
        this._themeButton.set_child(this._controlIcon(this._dark?'moon':'sun',18,tone));
        this._emptyIcon.gicon=this._iconFile('empty-monitor',tone);
        this._applyLanguage();
    }
    _refresh() {
        if (!this._active || this._process) return;
        this._footer.text=this._tr('querying');
        try {
            const proc=Gio.Subprocess.new(['/usr/bin/python3',`${this.path}/collector.py`],Gio.SubprocessFlags.STDOUT_PIPE|Gio.SubprocessFlags.STDERR_PIPE);
            this._process=proc;
            this._refreshButton.reactive=false;
            proc.communicate_utf8_async(null,null,(p,res)=>{
                try {
                    const [,output]=p.communicate_utf8_finish(res);
                    if (!this._active || this._process!==p) return;
                    if (!p.get_successful()) throw new Error('collector failed');
                    this._data=JSON.parse(output); this._failed=false;
                } catch(e) {
                    if (this._active && this._process===p) {this._failed=true; for (const row of Object.values(this._data.rows||{})) if (row) row.stale=true;}
                } finally {
                    if (this._active && this._process===p) {this._process=null;this._refreshButton.reactive=true;this._render();}
                }
            });
        } catch(e) {this._process=null;this._refreshButton.reactive=true;this._failed=true;this._render();}
    }
    _render() {
        if (!this._active) return;
        const data=this._data; const compact=k=>{const r=data.rows?.[k];return valid(r)&&!expired(r)?`${r.stale?'~':''}${Math.round(r.remaining)}%`:'—';};
        const known=Boolean(data.providers);
        const codex=known && data.providers.codex===true;
        const claude=known && data.providers.claude===true;
        this._panelGroups.codex.visible=codex; this._panelGroups.claude.visible=claude;
        this._groups.codex.visible=codex; this._groups.claude.visible=claude;
        this._panelDivider.visible=codex&&claude;
        this._panelEmpty.visible=!codex&&!claude; this._empty.visible=known&&!codex&&!claude;
        this._footer.x_align=known&&!codex&&!claude?Clutter.ActorAlign.CENTER:Clutter.ActorAlign.START;
        this._panelDemo.visible=Boolean(data.demo);
        this._panelCodex.text=compact('codex_5h'); this._panelClaude.text=compact('claude_5h');
        for (const [key, ui] of Object.entries(this._rows)) {
            const row=data.rows?.[key]; const ok=valid(row); const past=expired(row);
            ui.pct.text=ok&&!past?`${row.stale?'~':''}${row.remaining}${this._tr('remaining')}`:'—';
            ui.pct.set_style(`color: ${ok&&!past?color(row.remaining,this._dark):(this._dark?'#aaaaaa':'#666666')};`);
            ui.fill.width=ok&&!past?Math.round(WIDTH*row.remaining/100):0;
            ui.fill.set_style(`background-color: ${ok?color(row.remaining,this._dark):'transparent'}; border-radius: 4px;`);
            ui.timer.text=ok?`${row.stale?this._tr('stale'):''}${!Number.isFinite(row.reset_at) && row.active === false ? this._tr('inactive') : countdown(row.reset_at,this._language)}`:this._tr('noData');
        }
        for (const provider of ['codex','claude']) {
            const e=this[`_error_${provider}`]; const msg=data.errors?.[provider];
            e.text=translateError(this._language,msg); e.visible=Boolean(msg);
        }
        const time=data.checked_at?new Date(data.checked_at*1000).toLocaleTimeString(this._language==='ko'?'ko-KR':'en-US'):'—';
        this._footer.text=this._process?this._tr('querying'):this._failed?this._tr('failed'):known&&!codex&&!claude?this._tr('noCli'):`${data.demo?this._tr('demo'):''}${this._tr('updated')} ${time} · ${this._tr('interval')}`;
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
