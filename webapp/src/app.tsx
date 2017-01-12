/// <reference path="../../localtypings/pxtpackage.d.ts"/>
/// <reference path="../../built/pxtlib.d.ts"/>
/// <reference path="../../built/pxtblocks.d.ts"/>
/// <reference path="../../built/pxtsim.d.ts"/>
/// <reference path="../../built/pxtwinrt.d.ts"/>

import * as React from "react";
import * as ReactDOM from "react-dom";
import * as workspace from "./workspace";
import * as data from "./data";
import * as pkg from "./package";
import * as core from "./core";
import * as sui from "./sui";
import * as simulator from "./simulator";
import * as srceditor from "./srceditor"
import * as compiler from "./compiler"
import * as tdlegacy from "./tdlegacy"
import * as db from "./db"
import * as cmds from "./cmds"
import * as appcache from "./appcache";
import * as gallery from "./gallery";
import * as screenshot from "./screenshot";
import * as hidbridge from "./hidbridge";

import * as monaco from "./monaco"
import * as pxtjson from "./pxtjson"
import * as blocks from "./blocks"
import * as codecard from "./codecard"
import * as logview from "./logview"
import * as draganddrop from "./draganddrop";
import * as hwdbg from "./hwdbg"
import * as electron from "./electron";

type Header = pxt.workspace.Header;
type ScriptText = pxt.workspace.ScriptText;
type WorkspaceProvider = pxt.workspace.WorkspaceProvider;
type InstallHeader = pxt.workspace.InstallHeader;

import Cloud = pxt.Cloud;
import Util = pxt.Util;
let lf = Util.lf

export interface FileHistoryEntry {
    id: string;
    name: string;
    pos: srceditor.ViewState;
}

export interface EditorSettings {
    editorFontSize: number;
    fileHistory: FileHistoryEntry[];
}

interface IAppProps { }
interface IAppState {
    active?: boolean; // is this tab visible at all
    header?: Header;
    currFile?: pkg.File;
    fileState?: string;
    showFiles?: boolean;
    sideDocsLoadUrl?: string; // set once to load the side docs frame
    sideDocsCollapsed?: boolean;
    projectName?: string;

    tutorial?: string; // tutorial
    tutorialName?: string; // tutorial title
    tutorialSteps?: string[]; // tutorial steps
    tutorialStep?: number; // current tutorial page
    tutorialReady?: boolean; // current tutorial page
    tutorialUrl?: string; // current tutorial url
    tutorialCardLocation?: string; // current card location

    running?: boolean;
    compiling?: boolean;
    publishing?: boolean;
    hideEditorFloats?: boolean;
    collapseEditorTools?: boolean;
    showBlocks?: boolean;
    showParts?: boolean;
}

let theEditor: ProjectView;

interface ISettingsProps {
    parent: ProjectView;
    visible?: boolean;
}

class CloudSyncButton extends data.Component<ISettingsProps, {}> {
    renderCore() {
        Util.assert(pxt.appTarget.cloud && pxt.appTarget.cloud.workspaces);

        let par = this.props.parent
        let hd = par.state.header
        let hdId = hd ? hd.id : ""
        let btnClass = !hd || this.getData("pkg-status:" + hdId) == "saving" ? " disabled" : ""
        let save = () => {
            par.saveFileAsync()
                .then(() => par.state.currFile.epkg.savePkgAsync())
                .then(() => {
                    return workspace.syncAsync()
                })
                .done()
        }
        let needsUpload = hd && !hd.blobCurrent
        return <sui.Button class={btnClass} onClick={save}
            icon={"cloud " + (needsUpload ? "upload" : "") }
            popup={btnClass ? lf("Uploading...") : needsUpload ? lf("Will upload. Click to sync.") : lf("Stored in the cloud. Click to sync.") }
            />
    }
}

enum ScriptSearchMode {
    Packages,
    Projects
}

interface ScriptSearchState {
    searchFor?: string;
    mode?: ScriptSearchMode;
    visible?: boolean;
    search?: boolean;
}

class ScriptSearch extends data.Component<ISettingsProps, ScriptSearchState> {
    private prevGhData: pxt.github.GitRepo[] = [];
    private prevUrlData: Cloud.JsonScript[] = [];
    private prevGalleries: pxt.CodeCard[] = [];

    constructor(props: ISettingsProps) {
        super(props)
        this.state = {
            searchFor: '',
            mode: ScriptSearchMode.Packages,
            visible: false
        }
    }

    hide() {
        this.setState({ visible: false });
    }

    showAddPackages() {
        this.setState({ visible: true, mode: ScriptSearchMode.Packages, searchFor: '', search: true })
    }

    showOpenProject() {
        this.setState({ visible: true, mode: ScriptSearchMode.Projects, searchFor: '', search: true })
    }

    fetchGhData(): pxt.github.GitRepo[] {
        const cloud = pxt.appTarget.cloud || {};
        if (!cloud.packages || this.state.mode != ScriptSearchMode.Packages) return [];
        let searchFor = cloud.githubPackages ? this.state.searchFor : undefined;
        let res: pxt.github.GitRepo[] =
            searchFor || cloud.preferredPackages
                ? this.getData(`gh-search:${searchFor || cloud.preferredPackages.join('|')}`)
                : null
        if (res) this.prevGhData = res
        return this.prevGhData || []
    }

    fetchGalleries(): pxt.CodeCard[] {
        if (this.state.mode != ScriptSearchMode.Projects
            || sandbox
            || this.state.searchFor
            || !pxt.appTarget.appTheme.projectGallery) return [];
        let res = this.getData(`gallery:${encodeURIComponent(pxt.appTarget.appTheme.projectGallery)}`) as gallery.Gallery[];
        if (res) this.prevGalleries = Util.concat(res.map(g => g.cards));
        return this.prevGalleries;
    }

    fetchUrlData(): Cloud.JsonScript[] {
        if (this.state.mode != ScriptSearchMode.Projects) return []

        let scriptid = pxt.Cloud.parseScriptId(this.state.searchFor)
        if (scriptid) {
            let res = this.getData(`cloud:${scriptid}`)
            if (res) {
                if (!this.prevUrlData) this.prevUrlData = [res]
                else this.prevUrlData.push(res)
            }
        }
        return this.prevUrlData;
    }

    fetchBundled(): pxt.PackageConfig[] {
        if (this.state.mode != ScriptSearchMode.Packages || !!this.state.searchFor) return [];

        const bundled = pxt.appTarget.bundledpkgs;
        return Object.keys(bundled).filter(k => !/prj$/.test(k))
            .map(k => JSON.parse(bundled[k]["pxt.json"]) as pxt.PackageConfig);
    }

    fetchLocalData(): Header[] {
        if (this.state.mode != ScriptSearchMode.Projects) return [];

        let headers: Header[] = this.getData("header:*")
        if (this.state.searchFor)
            headers = headers.filter(hdr => hdr.name.toLowerCase().indexOf(this.state.searchFor.toLowerCase()) > -1);
        return headers;
    }

    shouldComponentUpdate(nextProps: ISettingsProps, nextState: ScriptSearchState, nextContext: any): boolean {
        return this.state.visible != nextState.visible
            || this.state.searchFor != nextState.searchFor
            || this.state.mode != nextState.mode;
    }

    renderCore() {
        if (!this.state.visible) return null;

        const headers = this.fetchLocalData();
        const bundles = this.fetchBundled();
        const ghdata = this.fetchGhData();
        const urldata = this.fetchUrlData();
        const galleries = this.fetchGalleries();

        const chgHeader = (hdr: Header) => {
            pxt.tickEvent("projects.header");
            this.hide();
            this.props.parent.loadHeaderAsync(hdr)
        }
        const chgBundle = (scr: pxt.PackageConfig) => {
            pxt.tickEvent("packages.bundled", { name: scr.name });
            this.hide();
            let p = pkg.mainEditorPkg();
            p.addDepAsync(scr.name, "*")
                .then(r => this.props.parent.reloadHeaderAsync())
                .done();
        }
        const chgGallery = (scr: pxt.CodeCard) => {
            pxt.tickEvent("projects.gallery", { name: scr.name });
            this.hide();
            this.props.parent.newEmptyProject(scr.name.toLowerCase(), scr.url);
        }
        const upd = (v: any) => {
            let str = (ReactDOM.findDOMNode(this.refs["searchInput"]) as HTMLInputElement).value
            this.setState({ searchFor: str })
        };
        const kupd = (ev: __React.KeyboardEvent) => {
            if (ev.keyCode == 13) upd(ev);
        }
        const installScript = (scr: Cloud.JsonScript) => {
            this.hide();
            if (this.state.mode == ScriptSearchMode.Projects) {
                core.showLoading(lf("loading project..."));
                workspace.installByIdAsync(scr.id)
                    .then(r => this.props.parent.loadHeaderAsync(r))
                    .done(() => core.hideLoading())
            }
        }
        const installGh = (scr: pxt.github.GitRepo) => {
            pxt.tickEvent("packages.github");
            this.hide();
            if (this.state.mode == ScriptSearchMode.Packages) {
                let p = pkg.mainEditorPkg();
                core.showLoading(lf("downloading package..."));
                pxt.packagesConfigAsync()
                    .then(config => pxt.github.latestVersionAsync(scr.fullName, config))
                    .then(tag => pxt.github.pkgConfigAsync(scr.fullName, tag)
                        .then(cfg => p.addDepAsync(cfg.name, "github:" + scr.fullName + "#" + tag))
                        .then(r => this.props.parent.reloadHeaderAsync()))
                    .catch(core.handleNetworkError)
                    .finally(() => core.hideLoading());
            } else {
                Util.oops()
            }
        }
        const importHex = () => {
            pxt.tickEvent("projects.import");
            this.hide();
            this.props.parent.importFileDialog();
        }
        const newProject = () => {
            pxt.tickEvent("projects.new");
            this.hide();
            this.props.parent.newEmptyProject();
        }
        const saveProject = () => {
            pxt.tickEvent("projects.save");
            this.hide();
            this.props.parent.compile(true);
        }
        const renameProject = () => {
            pxt.tickEvent("projects.rename");
            this.hide();
            this.props.parent.setFile(pkg.mainEditorPkg().files[pxt.CONFIG_NAME])
        }
        const isEmpty = () => {
            if (this.state.searchFor) {
                if (headers.length > 0
                    || bundles.length > 0
                    || ghdata.length > 0
                    || urldata.length > 0)
                    return false;
                return true;
            }
            return false;
        }

        const headerText = this.state.mode == ScriptSearchMode.Packages ? lf("Add Package...")
            : lf("Projects");
        return (
            <sui.Modal visible={this.state.visible} header={headerText} addClass="large searchdialog"
                onHide={() => this.setState({ visible: false }) }>
                {!this.state.searchFor && this.state.mode == ScriptSearchMode.Projects ?
                    <div className="ui vertical segment">
                        <sui.Button
                            icon="file outline"
                            text={lf("New Project...") }
                            title={lf("Creates a new empty project") }
                            onClick={() => newProject() } />
                        {pxt.appTarget.compile ?
                            <sui.Button
                                icon="upload"
                                text={lf("Import File...") }
                                title={lf("Open files from your computer") }
                                onClick={() => importHex() } /> : undefined}
                    </div> : undefined}
                <div className="ui vertical segment">
                {this.state.search ? <div className="ui search">
                    <div className="ui fluid action input" role="search">
                        <input ref="searchInput" type="text" placeholder={lf("Search...") } onKeyUp={kupd} />
                        <button title={lf("Search") } className="ui right icon button" onClick={upd}>
                            <i className="search icon"></i>
                        </button>
                    </div>
                </div> : undefined }
                <div className="ui cards">
                    {bundles.map(scr =>
                        <codecard.CodeCardView
                            key={'bundled' + scr.name}
                            name={scr.name}
                            description={scr.description}
                            url={"/" + scr.installedVersion}
                            onClick={() => chgBundle(scr) }
                            />
                    ) }
                    {headers.map(scr =>
                        <codecard.CodeCardView
                            key={'local' + scr.id}
                            name={scr.name}
                            time={scr.recentUse}
                            imageUrl={scr.icon}
                            url={scr.pubId && scr.pubCurrent ? "/" + scr.pubId : ""}
                            onClick={() => chgHeader(scr) }
                            />
                    ) }
                    {galleries.map(scr => <codecard.CodeCardView
                        key={'gal' + scr.name}
                        className="widedesktop only"
                        name={scr.name}
                        url={scr.url}
                        imageUrl={scr.imageUrl}
                        onClick={() => chgGallery(scr) }
                        />
                    ) }
                    {ghdata.filter(repo => repo.status == pxt.github.GitRepoStatus.Approved).map(scr =>
                        <codecard.CodeCardView
                            name={scr.name.replace(/^pxt-/, "") }
                            header={scr.fullName}
                            description={scr.description}
                            key={'gh' + scr.fullName}
                            onClick={() => installGh(scr) }
                            url={'github:' + scr.fullName}
                            color="blue"
                            />
                    ) }
                    {ghdata.filter(repo => repo.status != pxt.github.GitRepoStatus.Approved).map(scr =>
                        <codecard.CodeCardView
                            name={scr.name.replace(/^pxt-/, "") }
                            header={scr.fullName}
                            description={scr.description}
                            key={'gh' + scr.fullName}
                            onClick={() => installGh(scr) }
                            url={'github:' + scr.fullName}
                            color="red"
                            />
                    ) }
                    {urldata.map(scr =>
                        <codecard.CodeCardView
                            name={scr.name}
                            time={scr.time}
                            header={'/' + scr.id}
                            description={scr.description}
                            key={'cloud' + scr.id}
                            onClick={() => installScript(scr) }
                            url={'/' + scr.id}
                            color="blue"
                            />
                    ) }
                </div>
                { isEmpty() ?
                    <div className="ui items">
                        <div className="ui item">
                            {this.state.mode == ScriptSearchMode.Packages ?
                                lf("We couldn't find any packages matching '{0}'", this.state.searchFor) :
                                lf("We couldn't find any projects matching '{0}'", this.state.searchFor) }
                        </div>
                    </div>
                    : undefined }
                </div>
            </sui.Modal >
        );
    }
}

enum ShareMode {
    Screenshot,
    Editor,
    Url,
    Simulator,
    Cli
}

interface ShareEditorState {
    mode?: ShareMode;
    screenshotId?: string;
    screenshotUri?: string;
    currentPubId?: string;
    pubCurrent?: boolean;
    visible?: boolean;
}

class ShareEditor extends data.Component<ISettingsProps, ShareEditorState> {
    constructor(props: ISettingsProps) {
        super(props);
        this.state = {
            currentPubId: undefined,
            pubCurrent: false,
            visible: false
        }
    }

    hide() {
        this.setState({ visible: false });
    }

    show(header: Header) {
        this.setState({ visible: true, mode: ShareMode.Screenshot, pubCurrent: header.pubCurrent });
    }

    shouldComponentUpdate(nextProps: ISettingsProps, nextState: ShareEditorState, nextContext: any): boolean {
        return this.state.visible != nextState.visible
            || this.state.mode != nextState.mode
            || this.state.pubCurrent != nextState.pubCurrent
            || this.state.screenshotId != nextState.screenshotId
            || this.state.currentPubId != nextState.currentPubId;
    }

    renderCore() {
        if (!this.state.visible) return null;

        const cloud = pxt.appTarget.cloud || {};
        const publishingEnabled = cloud.publishing || false;
        const header = this.props.parent.state.header;

        let ready = false;
        let mode = this.state.mode;
        let url = '';
        let embed = '';
        let help = lf("Copy this HTML to your website or blog.");
        let helpUrl = "/share";

        if (header) {
            if (!header.pubCurrent && !publishingEnabled) {
                this.props.parent.exportAsync()
                    .then(filedata => {
                        header.pubCurrent = true;
                        this.setState({ pubCurrent: true, currentPubId: filedata, screenshotId: undefined })
                    });
            }

            let rootUrl = pxt.appTarget.appTheme.embedUrl
            if (!/\/$/.test(rootUrl)) rootUrl += '/';

            const isBlocks = this.props.parent.getPreferredEditor() == pxt.BLOCKS_PROJECT_NAME;
            const pubCurrent = header ? header.pubCurrent : false;
            let currentPubId = (header ? header.pubId : undefined) || this.state.currentPubId;

            ready = (!!currentPubId && header.pubCurrent);
            if (ready) {
                url = `${rootUrl}${header.pubId}`;
                let editUrl = `${rootUrl}#${publishingEnabled ? 'pub' : 'project'}:${currentPubId}`;
                switch (mode) {
                    case ShareMode.Cli:
                        embed = `pxt extract ${header.pubId}`;
                        help = lf("Run this command from a shell.");
                        helpUrl = "/cli";
                        break;
                    case ShareMode.Simulator:
                        let padding = '81.97%';
                        // TODO: parts aspect ratio
                        if (pxt.appTarget.simulator) padding = (100 / pxt.appTarget.simulator.aspectRatio).toPrecision(4) + '%';
                        embed = pxt.docs.runUrl(pxt.webConfig.runUrl || rootUrl + "--run", padding, header.pubId);
                        break;
                    case ShareMode.Editor:
                        embed = pxt.docs.embedUrl(rootUrl, publishingEnabled ? 'sandbox' : 'sandboxproject', currentPubId, header.meta.blocksHeight);
                        break;
                    case ShareMode.Url:
                        embed = editUrl;
                        break;
                    default:
                        if (isBlocks) {
                            // Render screenshot
                            if (this.state.screenshotId == currentPubId) {
                                if (this.state.screenshotUri)
                                    embed = `<a href="${editUrl}"><img src="${this.state.screenshotUri}" /></a>`
                                else embed = lf("Ooops, no screenshot available.");
                            } else {
                                pxt.debug("rendering share-editor screenshot png");
                                embed = lf("rendering...");
                                pxt.blocks.layout.toPngAsync(this.props.parent.blocksEditor.editor)
                                    .done(uri => this.setState({ screenshotId: currentPubId, screenshotUri: uri }));
                            }
                        } else {
                            // Render javascript code
                            pxt.debug("rendering share-editor javascript markdown");
                            embed = lf("rendering...")
                            let main = pkg.getEditorPkg(pkg.mainPkg)
                            let file = main.getMainFile()
                            if (pkg.File.blocksFileNameRx.test(file.getName()) && file.getVirtualFileName())
                                file = main.lookupFile("this/" + file.getVirtualFileName()) || file
                            if (pkg.File.tsFileNameRx.test(file.getName())) {
                                let fileContents = file.content;
                                let mdContent = pxt.docs.renderMarkdown(`@body@`, `\`\`\`javascript\n${fileContents}\n\`\`\``);
                                embed = `<a style="text-decoration: none;" href="${editUrl}">${mdContent}</a>`;
                            }
                        }
                        break;
                }
            }

        }
        const publish = () => {
            pxt.tickEvent("menu.embed.publish");
            this.props.parent.publishAsync().done(() => {
                this.setState({ pubCurrent: true });
            });
        }
        const formState = !ready ? 'warning' : this.props.parent.state.publishing ? 'loading' : 'success';

        return <sui.Modal visible={this.state.visible} addClass="small searchdialog" header={lf("Embed Project") }
            onHide={() => this.setState({ visible: false }) }>
            <div className={`ui ${formState} form`}>
                { publishingEnabled ?
                    <div className="ui warning message">
                        <div className="header">{lf("Almost there!") }</div>
                        <p>{lf("You need to publish your project to share it or embed it in other web pages.") +
                            lf("You acknowledge having consent to publish this project.") }</p>
                        <sui.Button class={"green " + (this.props.parent.state.publishing ? "loading" : "") } text={lf("Publish project") } onClick={publish} />
                    </div> : undefined }
                { url && publishingEnabled ? <div className="ui success message">
                    <h3>{lf("Project URL") }</h3>
                    <div className="header"><a target="_blank" href={url}>{url}</a></div>
                </div> : undefined }
                { !ready && !publishingEnabled ? <div className="ui warning message">
                    <h3>{lf("Loading...") }</h3>
                </div> : undefined }
                { ready ?
                    <div className="ui form">
                        <div className="inline fields">
                            <label>{lf("Embed...") }</label>
                            {[
                                { mode: ShareMode.Screenshot, label: lf("Screenshot") },
                                { mode: ShareMode.Editor, label: lf("Editor") }]
                                .concat(
                                !publishingEnabled ? [
                                    { mode: ShareMode.Url, label: lf("Link") }
                                ] : []
                                )
                                .concat(
                                publishingEnabled ? [
                                    { mode: ShareMode.Simulator, label: lf("Simulator") },
                                    { mode: ShareMode.Cli, label: lf("Command line") }
                                ] : []
                                )
                                .map(f =>
                                    <div key={f.mode.toString() } className="field">
                                        <div className="ui radio checkbox">
                                            <input type="radio" checked={mode == f.mode} onChange={() => this.setState({ mode: f.mode }) }/>
                                            <label>{f.label}</label>
                                        </div>
                                    </div>
                                ) }
                        </div>
                    </div> : undefined }
                { ready ?
                    <sui.Field>
                        <p>{help} <span><a target="_blank" href={helpUrl}>{lf("Help...") }</a></span></p>
                        <sui.Input class="mini" readOnly={true} lines={4} value={embed} copy={ready} disabled={!ready} />
                    </sui.Field> : null }
            </div>
        </sui.Modal>
    }
}

class DocsMenuItem extends data.Component<ISettingsProps, {}> {
    constructor(props: ISettingsProps) {
        super(props);
    }

    openDoc(path: string) {
        pxt.tickEvent(`docs`, { path });
        this.props.parent.setSideDoc(path);
    }

    render() {
        const targetTheme = pxt.appTarget.appTheme;
        const sideDocs = !(sandbox || pxt.options.light || targetTheme.hideSideDocs);
        return <sui.DropdownMenuItem icon="help" class="help-dropdown-menuitem" text={lf("Help") } textClass={"landscape only"} title={lf("Reference, lessons, ...") }>
            {targetTheme.docMenu.map(m => <a href={m.path} target="docs" key={"docsmenu" + m.path} role="menuitem" title={m.name} className={`ui item ${sideDocs && !/^https?:/i.test(m.path) ? "widedesktop hide" : ""}`}>{m.name}</a>) }
            {sideDocs ? targetTheme.docMenu.filter(m => !/^https?:/i.test(m.path)).map(m => <sui.Item key={"docsmenuwide" + m.path} role="menuitem" text={m.name} class="widedesktop only" onClick={() => this.openDoc(m.path) } />) : undefined  }
        </sui.DropdownMenuItem>
    }
}

class TutorialMenuItem extends data.Component<ISettingsProps, {}> {
    constructor(props: ISettingsProps) {
        super(props);
    }

    openTutorialStep(step: number) {
        pxt.tickEvent(`tutorial.step`, { tutorial: this.props.parent.state.tutorial, step: step });
        this.props.parent.setState({ tutorialStep: step, tutorialReady: false })
        this.props.parent.setTutorialStep(step);
    }

    render() {
        const state = this.props.parent.state;
        const tutorialReady = state.tutorialReady;
        const targetTheme = pxt.appTarget.appTheme;
        const tutorialSteps = state.tutorialSteps;
        const currentStep = state.tutorialStep;
        const tutorialName = state.tutorialName;

        return <div className="ui item">
            <div className="ui item">
                {tutorialName}
            </div>
            <div className="ui item tutorial-menuitem">
                {tutorialSteps.map((step, index) =>
                    <sui.Button key={'tutorialStep' + index} class={`icon circular ${currentStep == index ? 'red selected' : 'inverted'} ${!tutorialReady ? 'disabled' : ''}`} text={` ${index + 1} `} onClick={() => this.openTutorialStep(index) }/>
                ) }
            </div>
        </div>;
    }
}

interface TutorialOptions {
    tutorialId: string;
    tutorialName: string;
    showCategories?: boolean;
}

class TutorialContent extends data.Component<ISettingsProps, {}> {
    public static notify(message: pxsim.SimulatorMessage) {
        let tc = document.getElementById("tutorialcontent") as HTMLIFrameElement;
        if (tc && tc.contentWindow) tc.contentWindow.postMessage(message, "*");
    }

    constructor(props: ISettingsProps) {
        super(props);
    }

    setPath(path: string) {
        const docsUrl = pxt.webConfig.docsUrl || '/--docs';
        const mode = this.props.parent.editor == this.props.parent.blocksEditor
            ? "blocks" : "js";
        const url = `${docsUrl}#tutorial:${path}:${mode}:${pxt.Util.localeInfo()}`;
        this.setUrl(url);
    }

    private setUrl(url: string) {
        let el = document.getElementById("tutorialcontent") as HTMLIFrameElement;
        if (el) el.src = url;
        else this.props.parent.setState({ tutorialUrl: url });
    }

    public static refresh() {
        let el = document.getElementById("tutorialcontent") as HTMLIFrameElement;
        if (el && el.contentWindow) {
            el.parentElement.style.height = "";
            el.parentElement.style.height = el.contentWindow.document.body.scrollHeight + "px";
        }
    }

    renderCore() {
        const state = this.props.parent.state;
        const docsUrl = state.tutorialUrl;
        if (!docsUrl) return null;

        return <iframe id="tutorialcontent" onLoad={() => TutorialContent.refresh() } src={docsUrl} role="complementary" sandbox="allow-scripts allow-same-origin allow-popups" />
    }
}

class TutorialCard extends data.Component<ISettingsProps, {}> {
    constructor(props: ISettingsProps) {
        super(props);
    }

    previousTutorialStep() {
        const currentStep = this.props.parent.state.tutorialStep;
        const previousStep = currentStep - 1;

        pxt.tickEvent(`tutorial.previous`, { tutorial: this.props.parent.state.tutorial, step: previousStep });
        this.props.parent.setState({ tutorialStep: previousStep, tutorialReady: false })
        this.props.parent.setTutorialStep(previousStep);
    }

    nextTutorialStep() {
        const currentStep = this.props.parent.state.tutorialStep;
        const nextStep = currentStep + 1;

        pxt.tickEvent(`tutorial.next`, { tutorial: this.props.parent.state.tutorial, step: nextStep });
        this.props.parent.setState({ tutorialStep: nextStep, tutorialReady: false })
        this.props.parent.setTutorialStep(nextStep);
    }

    finishTutorial() {
        this.props.parent.exitTutorial();
    }

    setPath(path: string) {
        let tc = this.refs["tutorialcontent"] as TutorialContent;
        if (!tc) return;
        tc.setPath(path);
    }

    render() {
        const state = this.props.parent.state;
        const tutorialReady = state.tutorialReady;
        const currentStep = state.tutorialStep;
        const cardLocation = state.tutorialCardLocation || 'bottom';
        const maxSteps = state.tutorialSteps.length;
        const hasPrevious = currentStep != 0;
        const hasNext = currentStep != maxSteps - 1;
        const hasFinish = currentStep == maxSteps - 1;

        return <div id="tutorialcard" className={`ui ${pxt.options.light ? "" : "transition fly in"} ${cardLocation} ${tutorialReady ? 'visible active' : 'hidden'}`}>
            <div className="ui raised fluid card">
                <div className="ui">
                    <TutorialContent ref="tutorialcontent" parent={this.props.parent} />
                </div>
                <div className="extra content">
                    <div className="ui two buttons">
                        {hasPrevious ? <button className={`ui icon red button ${!tutorialReady ? 'disabled' : ''}`} onClick={() => this.previousTutorialStep() }>
                            <i className="left chevron icon"></i>
                            Previous
                        </button> : undefined }
                        {hasNext ? <button className={`ui right icon green button ${!tutorialReady ? 'disabled' : ''}`} onClick={() => this.nextTutorialStep() }>
                            Next
                            <i className="right chevron icon"></i>
                        </button> : undefined }
                        {hasFinish ? <button className={`ui right icon orange button ${!tutorialReady ? 'disabled' : ''}`} onClick={() => this.finishTutorial() }>
                            <i className="left checkmark icon"></i>
                            Finish
                        </button> : undefined }
                    </div>
                </div>
            </div>
        </div>;
    }
}

class EditorTools extends data.Component<ISettingsProps, {}> {
    constructor(props: ISettingsProps) {
        super(props);
    }

    saveProjectName (name: string) {
        pxt.tickEvent("editortools.projectrename");
        this.props.parent.updateHeaderName(name);
    }

    saveFile() {
        pxt.tickEvent("editortools.save");
        this.props.parent.compile(true);
    }

    openSettings() {
        pxt.tickEvent("editortools.settings");
        this.props.parent.setFile(pkg.mainEditorPkg().lookupFile("this/pxt.json"))
    }

    undo() {
        pxt.tickEvent("editortools.undo");
        this.props.parent.editor.undo();
    }

    redo() {
        pxt.tickEvent("editortools.redo");
        this.props.parent.editor.redo();
    }

    zoomIn() {
        pxt.tickEvent("editortools.zoomIn");
        this.props.parent.editor.zoomIn();
    }

    zoomOut() {
        pxt.tickEvent("editortools.zoomOut");
        this.props.parent.editor.zoomOut();
    }

    startStopSimulator() {
        pxt.tickEvent("editortools.startStopSimulator");
        this.props.parent.startStopSimulator();
    }

    restartSimulator() {
        pxt.tickEvent("editortools.restart");
        this.props.parent.restartSimulator();
    }

    toggleCollapse() {
        const state = this.props.parent.state;
        pxt.tickEvent("editortools.toggleCollapse", {'collapsed': '' + !state.collapseEditorTools});
        if (!state.running && state.collapseEditorTools)
            this.props.parent.startStopSimulator();

        if (state.collapseEditorTools) {
            this.props.parent.startSimulator();
            this.props.parent.setState({collapseEditorTools: false});
        }
        else {
            simulator.hide(() => {
                this.props.parent.setState({collapseEditorTools: true});
            })
        }
    }

    render() {
        const state = this.props.parent.state;
        const hideEditorFloats = state.hideEditorFloats;
        const collapsed = state.hideEditorFloats || state.collapseEditorTools;
        const isEditor = this.props.parent.editor == this.props.parent.blocksEditor || this.props.parent.editor == this.props.parent.textEditor;
        if (!isEditor) return <div />;

        const targetTheme = pxt.appTarget.appTheme;
        const compile = pxt.appTarget.compile;
        const compileBtn = compile.hasHex;
        const simOpts = pxt.appTarget.simulator;
        const make = !sandbox && state.showParts && simOpts && (simOpts.instructions || (simOpts.parts && pxt.options.debug));
        const compileTooltip = lf("Download your code to the {0}", targetTheme.boardName);
        const compileLoading = !!state.compiling;
        const runTooltip = state.running ? lf("Stop the simulator") : lf("Start the simulator");
        const makeTooltip = lf("Open assembly instructions");
        const restartTooltip = lf("Restart the simulator");
        const collapseTooltip = collapsed ? lf("Hide the simulator") : lf("Show the simulator");
        const run = true;

        return <div className="ui equal width grid right aligned padded">
                    <div className="column mobile only">
                        {collapsed ?
                        <div className="ui equal width grid">
                            <div className="left aligned column">
                                <div className="ui icon small buttons">
                                    <sui.Button icon={`${collapsed ? 'toggle right' : 'toggle left'}`} class={`collapse-button ${hideEditorFloats ? 'disabled' : ''}`} title={collapseTooltip} onClick={() => this.toggleCollapse() } />
                                    {compileBtn ? <sui.Button role="menuitem" class={`download-button download-button-full ${compileLoading ? 'loading' : ''}`} icon="download" title={compileTooltip} onClick={() => this.props.parent.compile() } /> : undefined }
                                </div>
                            </div>
                            <div className="right aligned column">
                                <div className="ui icon small buttons">
                                    <sui.Button icon='save' class="editortools-btn save-editortools-btn" title={lf("Save")} onClick={() => this.saveFile()} />
                                    <sui.Button icon='undo' class="editortools-btn undo-editortools-btn" title={lf("Undo")} onClick={() => this.undo()} />
                                </div>
                            </div>
                            <div className="right aligned column">
                                <div className="ui icon small buttons">
                                    <sui.Button icon='zoom' class="editortools-btn zoomin-editortools-btn" title={lf("Zoom In")} onClick={() => this.zoomIn()} />
                                    <sui.Button icon='zoom out' class="editortools-btn zoomout-editortools-btn" title={lf("Zoom Out")} onClick={() => this.zoomOut()} />
                                </div>
                            </div>
                        </div> :
                        <div className="ui equal width grid">
                            <div className="left aligned column">
                                <div className="ui vertical icon small buttons">
                                    {run ? <sui.Button role="menuitem" class="" key='runmenubtn' icon={state.running ? "stop" : "play"} title={runTooltip} onClick={() => this.startStopSimulator() } /> : undefined }
                                    {run ? <sui.Button key='restartbtn' class={`${compileBtn ? '' : ' fluid'} restart-button`} text={compileBtn ? undefined : lf("Restart") } icon="refresh" title={restartTooltip} onClick={() => this.restartSimulator() } /> : undefined }
                                </div>
                                <sui.Button icon={`${collapsed ? 'toggle right' : 'toggle left'}`} class="collapse-button" title={collapseTooltip} onClick={() => this.toggleCollapse() } />
                            </div>
                            <div className="two wide column">
                            </div>
                            <div className="ui grid column">
                                <div className="row">
                                    <div className="column">
                                        <div className="ui icon small buttons">
                                            <sui.Button icon='undo' class="editortools-btn undo-editortools-btn" title={lf("Undo")} onClick={() => this.undo()} />
                                            <sui.Button icon='zoom' class="editortools-btn zoomin-editortools-btn" title={lf("Zoom In")} onClick={() => this.zoomIn()} />
                                            <sui.Button icon='zoom out' class="editortools-btn zoomout-editortools-btn" title={lf("Zoom Out")} onClick={() => this.zoomOut()} />
                                        </div>
                                    </div>
                                </div>
                                <div className="row" style={{paddingTop: 0}}>
                                    <div className="column">
                                        <div className="ui icon large buttons">
                                            {compileBtn ? <sui.Button role="menuitem" class={`download-button download-button-full ${compileLoading ? 'loading' : ''}`} icon="download" text={lf("Download") } title={compileTooltip} onClick={() => this.props.parent.compile() } /> : undefined }
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div> }
                    </div>
                    <div className="column tablet only">
                        {collapsed ?
                        <div className="ui grid seven column">
                            <div className="left aligned six wide column">
                                <sui.Button icon={`${collapsed ? 'toggle right' : 'toggle left'}`} class={`large collapse-button ${hideEditorFloats ? 'disabled' : ''}`} title={collapseTooltip} onClick={() => this.toggleCollapse() } />
                                {compileBtn ? <sui.Button role="menuitem" class={`large download-button download-button-full ${compileLoading ? 'loading' : ''}`} icon="download" text={lf("Download") } title={compileTooltip} onClick={() => this.props.parent.compile() } /> : undefined }
                            </div>
                            <div className="column four wide">
                                <sui.Button icon='save' class="large editortools-btn save-editortools-btn" title={lf("Save")} onClick={() => this.saveFile()} />
                            </div>
                            <div className="column six wide right aligned">
                                <div className="ui icon large buttons">
                                    <sui.Button icon='undo' class="editortools-btn undo-editortools-btn" title={lf("Undo")} onClick={() => this.undo()} />
                                    <sui.Button icon='repeat' class="editortools-btn redo-editortools-btn" title={lf("Redo")} onClick={() => this.redo()} />
                                </div>
                                <div className="ui icon large buttons">
                                    <sui.Button icon='zoom' class="editortools-btn zoomin-editortools-btn" title={lf("Zoom In")} onClick={() => this.zoomIn()} />
                                    <sui.Button icon='zoom out' class="editortools-btn zoomout-editortools-btn" title={lf("Zoom Out")} onClick={() => this.zoomOut()} />
                                </div>
                            </div>
                        </div>
                        : <div className="ui grid">
                            <div className="one wide column">
                                <div className="ui vertical icon small buttons">
                                    {run ? <sui.Button role="menuitem" class="" key='runmenubtn' icon={state.running ? "stop" : "play"} title={runTooltip} onClick={() => this.startStopSimulator() } /> : undefined }
                                    {run ? <sui.Button key='restartbtn' class={`${compileBtn ? '' : 'fluid'} restart-button`} text={compileBtn ? undefined : lf("Restart") } icon="refresh" title={restartTooltip} onClick={() => this.restartSimulator() } /> : undefined }
                                    <sui.Button icon={`${collapsed ? 'toggle right' : 'toggle left'}`} class="collapse-button" title={collapseTooltip} onClick={() => this.toggleCollapse() } />
                                </div>
                            </div>
                            <div className="four wide column">
                            </div>
                            <div className="five wide column">
                                <div className="ui grid right aligned">
                                    <div className="row">
                                        <div className="column">
                                            {compileBtn ? <sui.Button role="menuitem" class={`large fluid download-button download-button-full ${compileLoading ? 'loading' : ''}`} icon="download" text={lf("Download") } title={compileTooltip} onClick={() => this.props.parent.compile() } /> : undefined }
                                        </div>
                                    </div>
                                    <div className="row" style={{paddingTop: 0}}>
                                        <div className="column">
                                            <div className="ui item large right labeled fluid input projectname-input projectname-tablet" title={lf("Pick a name for your project") }>
                                                <input id="fileNameInput"
                                                    type="text"
                                                    placeholder={lf("Pick a name...") }
                                                    value={state.projectName || ''}
                                                    onChange={(e) => this.saveProjectName((e.target as any).value) }>
                                                </input>
                                                <sui.Button icon='save' class="large right attached editortools-btn save-editortools-btn" title={lf("Save")} onClick={() => this.saveFile()} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="six wide column right aligned">
                                <div className="ui icon large buttons">
                                    <sui.Button icon='undo' class="editortools-btn undo-editortools-btn" title={lf("Undo")} onClick={() => this.undo()} />
                                    <sui.Button icon='repeat' class="editortools-btn redo-editortools-btn" title={lf("Redo")} onClick={() => this.redo()} />
                                </div>
                                <div className="ui icon large buttons">
                                    <sui.Button icon='zoom' class="editortools-btn zoomin-editortools-btn" title={lf("Zoom In")} onClick={() => this.zoomIn()} />
                                    <sui.Button icon='zoom out' class="editortools-btn zoomout-editortools-btn" title={lf("Zoom Out")} onClick={() => this.zoomOut()} />
                                </div>
                            </div>
                        </div> }
                    </div>
                    <div className="column computer only">
                        <div className="ui grid equal width">
                            <div id="downloadArea" className="ui column items">
                                <div className="ui item">
                                    <sui.Button icon={`${collapsed ? 'toggle right' : 'toggle left'}`} class="large collapse-button" title={collapseTooltip} onClick={() => this.toggleCollapse() } />
                                    {compileBtn ? <sui.Button icon='icon download' class={`huge fluid download-button ${compileLoading ? 'loading' : ''}`} text={lf("Download") } title={compileTooltip} onClick={() => this.props.parent.compile() } /> : undefined }
                                </div>
                            </div>
                            <div className="column left aligned">
                                <div className={`ui large right labeled input projectname-input projectname-computer`} title={lf("Pick a name for your project") }>
                                    <input id="fileNameInput"
                                        type="text"
                                        placeholder={lf("Pick a name...") }
                                        value={state.projectName || ''}
                                        onChange={(e) => this.saveProjectName((e.target as any).value) }>
                                    </input>
                                <sui.Button icon='save' class="small right attached editortools-btn save-editortools-btn" title={lf("Save")} onClick={() => this.saveFile()} />
                                </div>
                            </div>
                            <div className="column right aligned">
                                <div className="ui icon small buttons">
                                    <sui.Button icon='undo' class="editortools-btn undo-editortools-btn" title={lf("Undo")} onClick={() => this.undo()} />
                                    <sui.Button icon='repeat' class="editortools-btn redo-editortools-btn" title={lf("Redo")} onClick={() => this.redo()} />
                                </div>
                                <div className="ui icon small buttons">
                                    <sui.Button icon='zoom' class="editortools-btn zoomin-editortools-btn" title={lf("Zoom In")} onClick={() => this.zoomIn()} />
                                    <sui.Button icon='zoom out' class="editortools-btn zoomout-editortools-btn" title={lf("Zoom Out")} onClick={() => this.zoomOut()} />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>;
    }
}

class SideDocs extends data.Component<ISettingsProps, {}> {
    public static notify(message: pxsim.SimulatorMessage) {
        let sd = document.getElementById("sidedocs") as HTMLIFrameElement;
        if (sd && sd.contentWindow) sd.contentWindow.postMessage(message, "*");
    }

    constructor(props: ISettingsProps) {
        super(props);
    }

    setPath(path: string) {
        const docsUrl = pxt.webConfig.docsUrl || '/--docs';
        const mode = this.props.parent.editor == this.props.parent.blocksEditor
            ? "blocks" : "js";
        const url = `${docsUrl}#doc:${path}:${mode}:${pxt.Util.localeInfo()}`;
        this.setUrl(url);
    }

    setMarkdown(md: string) {
        const docsUrl = pxt.webConfig.docsUrl || '/--docs';
        const mode = this.props.parent.editor == this.props.parent.blocksEditor
            ? "blocks" : "js";
        const url = `${docsUrl}#md:${encodeURIComponent(md)}:${mode}:${pxt.Util.localeInfo()}`;
        this.setUrl(url);
    }

    private setUrl(url: string) {
        let el = document.getElementById("sidedocs") as HTMLIFrameElement;
        if (el) el.src = url;
        else this.props.parent.setState({ sideDocsLoadUrl: url });
        this.props.parent.setState({ sideDocsCollapsed: false });
    }

    collapse() {
        this.props.parent.setState({ sideDocsCollapsed: true });
    }

    popOut() {
        SideDocs.notify({
            type: "popout"
        })
    }

    toggleVisibility() {
        const state = this.props.parent.state;
        this.props.parent.setState({ sideDocsCollapsed: !state.sideDocsCollapsed });
    }

    componentDidUpdate() {
        this.props.parent.editor.resize();
    }

    renderCore() {
        const state = this.props.parent.state;
        const docsUrl = state.sideDocsLoadUrl;
        if (!docsUrl) return null;

        const icon = !docsUrl || state.sideDocsCollapsed ? "expand" : "compress";
        return <div>
            <iframe id="sidedocs" src={docsUrl} role="complementary" sandbox="allow-scripts allow-same-origin allow-popups" />
            <button id="sidedocspopout" role="button" title={lf("Open documentation in new tab") } className={`circular ui icon button ${state.sideDocsCollapsed ? "hidden" : ""}`} onClick={() => this.popOut() }>
                <i className={`external icon`}></i>
            </button>
            <button id="sidedocsexpand" role="button" title={lf("Show/Hide side documentation") } className="circular ui icon button" onClick={() => this.toggleVisibility() }>
                <i className={`${icon} icon`}></i>
            </button>
        </div>
    }
}

interface FileListState {
    expands: pxt.Map<boolean>;
}

class FileList extends data.Component<ISettingsProps, FileListState> {

    constructor(props: ISettingsProps) {
        super(props);
        this.state = {
            expands: {}
        }
    }

    private removePkg(e: React.MouseEvent, p: pkg.EditorPackage) {
        e.stopPropagation();
        core.confirmAsync({
            header: lf("Remove {0} package", p.getPkgId()),
            body: lf("You are about to remove a package from your project. Are you sure?"),
            agreeClass: "red",
            agreeIcon: "trash",
            agreeLbl: lf("Remove it"),
        }).done(res => {
            if (res) {
                pkg.mainEditorPkg().removeDepAsync(p.getPkgId())
                    .then(() => this.props.parent.reloadHeaderAsync())
                    .done()
            }
        })
    }

    private removeFile(e: React.MouseEvent, f: pkg.File) {
        e.stopPropagation();
        this.props.parent.removeFile(f);
    }

    private updatePkg(e: React.MouseEvent, p: pkg.EditorPackage) {
        e.stopPropagation();
        pkg.mainEditorPkg().updateDepAsync(p.getPkgId())
            .then(() => this.props.parent.reloadHeaderAsync())
            .done()
    }

    private filesOf(pkg: pkg.EditorPackage): JSX.Element[] {
        const deleteFiles = pkg.getPkgId() == "this";
        const parent = this.props.parent;
        return pkg.sortedFiles().map(file => {
            let meta: pkg.FileMeta = this.getData("open-meta:" + file.getName())
            return (
                <a key={file.getName() }
                    onClick={() => parent.setSideFile(file) }
                    className={(parent.state.currFile == file ? "active " : "") + (pkg.isTopLevel() ? "" : "nested ") + "item"}
                    >
                    {file.name} {meta.isSaved ? "" : "*"}
                    {/\.ts$/.test(file.name) ? <i className="align left icon"></i> : /\.blocks$/.test(file.name) ? <i className="puzzle icon"></i> : undefined }
                    {meta.isReadonly ? <i className="lock icon"></i> : null}
                    {!meta.numErrors ? null : <span className='ui label red'>{meta.numErrors}</span>}
                    {deleteFiles && /\.blocks$/i.test(file.getName()) ? <sui.Button class="primary label" icon="trash" onClick={(e) => this.removeFile(e, file) } /> : ''}
                </a>);
        })
    }

    private packageOf(p: pkg.EditorPackage) {
        const expands = this.state.expands;
        let del = p.getPkgId() != pxt.appTarget.id && p.getPkgId() != "built";
        let upd = p.getKsPkg() && p.getKsPkg().verProtocol() == "github";
        return [<div key={"hd-" + p.getPkgId() } className="header link item" onClick={() => this.togglePkg(p) }>
            <i className={`chevron ${expands[p.getPkgId()] ? "down" : "right"} icon`}></i>
            {upd ? <sui.Button class="primary label" icon="refresh" onClick={(e) => this.updatePkg(e, p) } /> : ''}
            {del ? <sui.Button class="primary label" icon="trash" onClick={(e) => this.removePkg(e, p) } /> : ''}
            {p.getPkgId() }
        </div>
        ].concat(expands[p.getPkgId()] ? this.filesOf(p) : [])
    }

    private togglePkg(p: pkg.EditorPackage) {
        const expands = this.state.expands;
        expands[p.getPkgId()] = !expands[p.getPkgId()];
        this.forceUpdate();
    }

    private filesWithHeader(p: pkg.EditorPackage) {
        return p.isTopLevel() ? this.filesOf(p) : this.packageOf(p);
    }

    private toggleVisibility() {
        this.props.parent.setState({ showFiles: !this.props.parent.state.showFiles });
    }

    renderCore() {
        const show = !!this.props.parent.state.showFiles;
        const targetTheme = pxt.appTarget.appTheme;
        return <div className={`ui tiny vertical ${targetTheme.invertedMenu ? `inverted` : ''} menu filemenu landscape only`}>
            <div key="projectheader" className="link item" onClick={() => this.toggleVisibility() }>
                {lf("Explorer") }
                <i className={`chevron ${show ? "down" : "right"} icon`}></i>
            </div>
            {show ? Util.concat(pkg.allEditorPkgs().map(p => this.filesWithHeader(p))) : undefined }
        </div>;
    }
}

interface ProjectCreationOptions {
    prj?: pxt.ProjectTemplate;
    name?: string;
    documentation?: string;
    filesOverride?: pxt.Map<string>;
    temporary?: boolean;
}


export class ProjectView extends data.Component<IAppProps, IAppState> {
    editor: srceditor.Editor;
    editorFile: pkg.File;
    textEditor: monaco.Editor;
    pxtJsonEditor: pxtjson.Editor;
    blocksEditor: blocks.Editor;
    allEditors: srceditor.Editor[] = [];
    settings: EditorSettings;
    scriptSearch: ScriptSearch;
    shareEditor: ShareEditor;

    private lastChangeTime: number;
    private reload: boolean;

    constructor(props: IAppProps) {
        super(props);
        document.title = pxt.appTarget.title || pxt.appTarget.name;
        this.reload = false; //set to true in case of reset of the project where we are going to reload the page.
        this.settings = JSON.parse(pxt.storage.getLocal("editorSettings") || "{}")
        this.state = {
            showFiles: false,
            active: document.visibilityState == 'visible'
        };
        if (!this.settings.editorFontSize) this.settings.editorFontSize = /mobile/i.test(navigator.userAgent) ? 15 : 20;
        if (!this.settings.fileHistory) this.settings.fileHistory = [];
    }

    updateVisibility() {
        let active = document.visibilityState == 'visible';
        pxt.debug(`page visibility: ${active}`)
        this.setState({ active: active })
        if (!active) {
            this.stopSimulator();
            this.saveFileAsync().done();
        } else {
            if (workspace.isSessionOutdated()) {
                pxt.debug('workspace changed, reloading...')
                let id = this.state.header ? this.state.header.id : '';
                workspace.initAsync()
                    .done(() => id ? this.loadHeaderAsync(workspace.getHeader(id)) : Promise.resolve());
            } else if (pxt.appTarget.simulator.autoRun && !this.state.running)
                this.runSimulator();
        }
    }

    saveSettings() {
        let sett = this.settings

        if (this.reload) {
            return;
        }

        let f = this.editorFile
        if (f && f.epkg.getTopHeader()) {
            let n: FileHistoryEntry = {
                id: f.epkg.getTopHeader().id,
                name: f.getName(),
                pos: this.editor.getViewState()
            }
            sett.fileHistory = sett.fileHistory.filter(e => e.id != n.id || e.name != n.name)
            while (sett.fileHistory.length > 100)
                sett.fileHistory.pop()
            sett.fileHistory.unshift(n)
        }

        pxt.storage.setLocal("editorSettings", JSON.stringify(this.settings))
    }

    componentDidUpdate() {
        this.saveSettings()
        this.editor.domUpdate();
        simulator.setState(this.state.header ? this.state.header.editor : '')
        this.editor.resize();
    }

    fireResize() {
        if (document.createEvent) { // W3C
            let event = document.createEvent('Event');
            event.initEvent('resize', true, true);
            window.dispatchEvent(event);
        } else { // IE
            (document as any).fireEvent('onresize');
        }
    }

    saveFile() {
        simulator.makeDirty();
        this.saveFileAsync().done()
    }

    saveFileAsync() {
        if (!this.editorFile)
            return Promise.resolve()
        return this.saveTypeScriptAsync()
            .then(() => {
                let txt = this.editor.getCurrentSource()
                return this.editorFile.setContentAsync(txt);
            });
    }

    openTypeScriptAsync(): Promise<void> {
        return this.saveTypeScriptAsync(true)
            .then(() => {
                const header = this.state.header;
                if (header) {
                    header.editor = pxt.JAVASCRIPT_PROJECT_NAME;
                    header.pubCurrent = false
                }
            });
    }

    public typecheckNow() {
        this.saveFile(); // don't wait for saving to backend store to finish before typechecking
        this.typecheck()
    }

    private autoRunBlocksSimulator = pxtc.Util.debounce(
        () => {
            if (Util.now() - this.lastChangeTime < 1000) return;
            if (!this.state.active)
                return;
            this.runSimulator({ background: true });
        },
        1000, true);

    private autoRunSimulator = pxtc.Util.debounce(
        () => {
            if (Util.now() - this.lastChangeTime < 1000) return;
            if (!this.state.active)
                return;
            this.runSimulator({ background: true });
        },
        2000, true);

    private typecheck = pxtc.Util.debounce(
        () => {
            let state = this.editor.snapshotState()
            compiler.typecheckAsync()
                .done(resp => {
                    this.editor.setDiagnostics(this.editorFile, state)
                    if (pxt.appTarget.simulator && pxt.appTarget.simulator.autoRun) {
                        let output = pkg.mainEditorPkg().outputPkg.files["output.txt"];
                        if (output && !output.numDiagnosticsOverride
                            && !simulator.driver.runOptions.debug
                            && (simulator.driver.state == pxsim.SimulatorState.Running
                                || simulator.driver.state == pxsim.SimulatorState.Unloaded)) {
                            if (this.editor == this.blocksEditor) this.autoRunBlocksSimulator();
                            else this.autoRunSimulator();
                        }
                    }
                });
        }, 1000, false);

    private markdownChangeHandler = Util.debounce(() => {
        if (this.state.currFile && /\.md$/i.test(this.state.currFile.name))
            this.setSideMarkdown(this.editor.getCurrentSource());
    }, 4000, false);
    private editorChangeHandler = Util.debounce(() => {
        if (!this.editor.isIncomplete()) {
            this.saveFile();
            this.typecheck();
        }
        this.markdownChangeHandler();
    }, 500, false);
    private initEditors() {
        this.textEditor = new monaco.Editor(this);
        this.pxtJsonEditor = new pxtjson.Editor(this);
        this.blocksEditor = new blocks.Editor(this);

        let changeHandler = () => {
            if (this.editorFile) {
                if (this.editorFile.inSyncWithEditor)
                    pxt.tickActivity("edit", "edit." + this.editor.getId().replace(/Editor$/, ''))
                this.editorFile.markDirty();
            }
            this.lastChangeTime = Util.now();
            if (this.state.running
                && pxt.appTarget.simulator && pxt.appTarget.simulator.stopOnChange)
                this.stopSimulator();
            this.editorChangeHandler();
        }
        this.allEditors = [this.pxtJsonEditor, this.blocksEditor, this.textEditor]
        this.allEditors.forEach(e => e.changeCallback = changeHandler)
        this.editor = this.allEditors[this.allEditors.length - 1]
    }

    public componentWillMount() {
        this.initEditors()
        this.initDragAndDrop();
    }

    public componentDidMount() {
        this.allEditors.forEach(e => e.prepare())
        simulator.init($("#boardview")[0], {
            highlightStatement: stmt => {
                if (this.editor) this.editor.highlightStatement(stmt)
            },
            restartSimulator: () => {
                core.hideDialog();
                this.runSimulator();
            },
            editor: this.state.header ? this.state.header.editor : ''
        })
        this.forceUpdate(); // we now have editors prepared
    }

    private pickEditorFor(f: pkg.File): srceditor.Editor {
        return this.allEditors.filter(e => e.acceptsFile(f))[0]
    }

    private updateEditorFile(editorOverride: srceditor.Editor = null) {
        if (!this.state.active)
            return;
        if (this.state.currFile == this.editorFile && !editorOverride)
            return;
        this.saveSettings();

        this.saveFile(); // before change

        this.editorFile = this.state.currFile;
        this.editor = editorOverride || this.pickEditorFor(this.editorFile)
        this.editor.loadFile(this.editorFile)
        this.allEditors.forEach(e => e.setVisible(e == this.editor))

        this.saveFile(); // make sure state is up to date
        this.typecheck();

        let e = this.settings.fileHistory.filter(e => e.id == this.state.header.id && e.name == this.editorFile.getName())[0]
        if (e)
            this.editor.setViewState(e.pos)

        SideDocs.notify({
            type: "fileloaded",
            name: this.editorFile.getName(),
            locale: pxt.Util.localeInfo()
        } as pxsim.SimulatorFileLoadedMessage)

        if (this.state.showBlocks && this.editor == this.textEditor) this.textEditor.openBlocks();
    }

    setFile(fn: pkg.File) {
        if (!fn) return;

        this.setState({
            currFile: fn,
            showBlocks: false
        })
        //this.fireResize();
    }

    setSideFile(fn: pkg.File) {
        const header = this.state.header;
        if (header) {
            header.editor = this.getPreferredEditor();
            header.pubCurrent = false
        }
        let fileName = fn.name;
        let currFile = this.state.currFile.name;
        if (fileName != currFile && pkg.File.blocksFileNameRx.test(fileName)) {
            // Going from ts -> blocks
            pxt.tickEvent("sidebar.showBlocks");
            let tsFileName = fn.getVirtualFileName();
            let tsFile = pkg.mainEditorPkg().lookupFile("this/" + tsFileName)
            if (currFile == tsFileName) {
                // current file is the ts file, so just switch
                this.textEditor.openBlocks();
            } else if (tsFile) {
                this.textEditor.decompileAsync(tsFile.name).then((success) => {
                    if (!success) {
                        this.setFile(tsFile)
                        this.textEditor.showConversionFailedDialog(fn.name)
                    } else {
                        this.setFile(fn)
                    }
                });
            }
        } else {
            this.setFile(fn)
        }
    }

    removeFile(fn: pkg.File, skipConfirm = false) {
        const removeIt = () => {
            pkg.mainEditorPkg().removeFileAsync(fn.name)
                .then(() => pkg.mainEditorPkg().saveFilesAsync(true))
                .then(() => this.reloadHeaderAsync())
                .done();
        }

        if (skipConfirm) {
            removeIt();
            return;
        }

        core.confirmAsync({
            header: lf("Remove {0}", fn.name),
            body: lf("You are about to remove a file from your project. Are you sure?"),
            agreeClass: "red",
            agreeIcon: "trash",
            agreeLbl: lf("Remove it"),
        }).done(res => {
            if (res) removeIt();
        })
    }

    setSideMarkdown(md: string) {
        let sd = this.refs["sidedoc"] as SideDocs;
        if (!sd) return;
        sd.setMarkdown(md);
    }

    setSideDoc(path: string) {
        let sd = this.refs["sidedoc"] as SideDocs;
        if (!sd) return;
        if (path) sd.setPath(path);
        else sd.collapse();
    }

    setTutorialStep(step: number) {
        // save and typecheck
        this.typecheckNow();
        // Notify tutorial content pane
        let tc = this.refs["tutorialcard"] as TutorialCard;
        if (!tc) return;
        if (step > -1) {
            TutorialContent.notify({
                type: "tutorial",
                tutorial: this.state.tutorial,
                subtype: "stepchange",
                step: step
            } as pxsim.TutorialStepChangeMessage)
        }
    }

    handleMessage(msg: pxsim.SimulatorMessage) {
        switch (msg.type) {
            case "tutorial":
                let t = msg as pxsim.TutorialMessage;
                switch (t.subtype) {
                    case 'steploaded':
                        let tt = msg as pxsim.TutorialStepLoadedMessage;
                        let showCategories = tt.showCategories ? tt.showCategories : Object.keys(tt.data).length > 7;
                        this.editor.filterToolbox(tt.data, showCategories, false);
                        this.setState({ tutorialReady: true, tutorialCardLocation: tt.location });
                        TutorialContent.refresh();
                        core.hideLoading();
                        break;
                }
                break;
        }
    }

    reloadHeaderAsync() {
        return this.loadHeaderAsync(this.state.header)
    }

    loadHeaderAsync(h: Header): Promise<void> {
        if (!h)
            return Promise.resolve()

        this.stopSimulator(true);
        pxt.blocks.cleanBlocks();
        let logs = this.refs["logs"] as logview.LogView;
        logs.clear();
        this.setState({
            showFiles: false
        })
        return pkg.loadPkgAsync(h.id)
            .then(() => {
                compiler.newProject();
                let e = this.settings.fileHistory.filter(e => e.id == h.id)[0]
                let main = pkg.getEditorPkg(pkg.mainPkg)
                let file = main.getMainFile()
                if (e)
                    file = main.lookupFile(e.name) || file
                if (!e && h.editor == pxt.JAVASCRIPT_PROJECT_NAME && !pkg.File.tsFileNameRx.test(file.getName()) && file.getVirtualFileName())
                    file = main.lookupFile("this/" + file.getVirtualFileName()) || file;
                if (pkg.File.blocksFileNameRx.test(file.getName()) && file.getVirtualFileName()) {
                    if (!file.content) // empty blocks file, open javascript editor
                        file = main.lookupFile("this/" + file.getVirtualFileName()) || file
                    else this.textEditor.decompileAsync(file.getVirtualFileName()).then((success) => {
                        if (!success)
                            file = main.lookupFile("this/" + file.getVirtualFileName()) || file
                    });
                }
                this.setState({
                    header: h,
                    projectName: h.name,
                    currFile: file
                })
                if (!sandbox)
                    core.infoNotification(lf("Project loaded: {0}", h.name))
                pkg.getEditorPkg(pkg.mainPkg).onupdate = () => {
                    this.loadHeaderAsync(h).done()
                }

                pkg.mainPkg.getCompileOptionsAsync()
                    .catch(e => {
                        if (e instanceof pxt.cpp.PkgConflictError) {
                            const confl = e as pxt.cpp.PkgConflictError
                            const remove = (lib: pxt.Package) => ({
                                label: lf("Remove {0}", lib.id),
                                class: "pink", // don't make them red and scary
                                icon: "trash",
                                onclick: () => {
                                    core.showLoading(lf("Removing {0}...", lib.id))
                                    pkg.mainEditorPkg().removeDepAsync(lib.id)
                                        .then(() => this.reloadHeaderAsync())
                                        .done(() => core.hideLoading());
                                }
                            })
                            core.dialogAsync({
                                hideCancel: true,
                                buttons: [
                                    remove(confl.pkg1), // show later first in dialog
                                    remove(confl.pkg0)
                                ],
                                header: lf("Packages cannot be used together"),
                                body: lf("Packages '{0}' and '{1}' cannot be used together, because they use incompatible settings ({2}).",
                                    confl.pkg1.id, confl.pkg0.id, confl.settingName)
                            })
                        }
                    })
                    .done()

                let readme = main.lookupFile("this/README.md");
                if (readme && readme.content && readme.content.trim())
                    this.setSideMarkdown(readme.content);
                else if (pkg.mainPkg.config.documentation)
                    this.setSideDoc(pkg.mainPkg.config.documentation);
            })
    }

    removeProject() {
        if (!pkg.mainEditorPkg().header) return;

        core.confirmDelete(pkg.mainEditorPkg().header.name, () => {
            let curr = pkg.mainEditorPkg().header
            curr.isDeleted = true
            return workspace.saveAsync(curr, {})
                .then(() => {
                    if (workspace.getHeaders().length > 0) {
                        this.scriptSearch.showOpenProject();
                    } else {
                        this.newProject();
                    }
                })
        })
    }

    importHexFile(file: File) {
        if (!file) return;
        pxt.cpp.unpackSourceFromHexFileAsync(file)
            .done(data => this.importHex(data));
    }

    importBlocksFiles(file: File) {
        if (!file) return;
        fileReadAsTextAsync(file)
            .done(contents => {
                this.newProject({
                    filesOverride: { "main.blocks": contents, "main.ts": "  " },
                    name: file.name.replace(/\.blocks$/i, '') || lf("Untitled")
                })
            })
    }

    importTypescriptFile(file: File) {
        if (!file) return;
        fileReadAsTextAsync(file)
            .done(contents => {
                this.newProject({
                    filesOverride: { "main.blocks": '', "main.ts": contents || "  " },
                    name: file.name.replace(/\.ts$/i, '') || lf("Untitled")
                })
            })
    }

    importHex(data: pxt.cpp.HexFile) {
        const targetId = pxt.appTarget.id;
        const forkid = pxt.appTarget.forkof;
        if (!data || !data.meta) {
            core.warningNotification(lf("Sorry, we could not recognize this file."))
            return;
        }
        if (data.meta.cloudId == "microbit.co.uk" && data.meta.editor == "blockly") {
            pxt.tickEvent("import.blocks")
            pxt.debug('importing microbit.co.uk blocks project')
            core.showLoading(lf("loading project..."))
            compiler.getBlocksAsync()
                .then(info => this.createProjectAsync({
                    filesOverride: {
                        "main.blocks": pxt.blocks.importXml(data.source, info)
                    }, name: data.meta.name
                })).done(() => core.hideLoading());
            return;
        } else if (data.meta.cloudId == "microbit.co.uk" && data.meta.editor == "touchdevelop") {
            pxt.tickEvent("import.td")
            pxt.debug('importing microbit.co.uk TD project')
            core.showLoading("loading project...")
            this.createProjectAsync({
                filesOverride: { "main.blocks": "<xml xmlns=\"http://www.w3.org/1999/xhtml\">", "main.ts": "  " },
                name: data.meta.name
            })
                .then(() => this.openTypeScriptAsync())
                .then(() => tdlegacy.td2tsAsync(data.source))
                .then(text => {
                    // this is somewhat hacky...
                    this.textEditor.overrideFile(text);
                    this.textEditor.formatCode();
                }).done(() => core.hideLoading());
            return;
        } else if (data.meta.cloudId == "ks/" + targetId || data.meta.cloudId == pxt.CLOUD_ID + targetId // match on targetid
            || (!forkid && Util.startsWith(data.meta.cloudId, pxt.CLOUD_ID + targetId)) // trying to load white-label file into main target
            || (forkid && data.meta.cloudId == pxt.CLOUD_ID + forkid) // trying to load main target file into white-label
        ) {
            pxt.tickEvent("import.pxt")
            pxt.debug("importing project")
            let h: InstallHeader = {
                target: targetId,
                editor: data.meta.editor,
                name: data.meta.name,
                meta: {},
                pubId: "",
                pubCurrent: false
            };
            const files = JSON.parse(data.source) as pxt.Map<string>;
            // basic xml validation of main.blocks.
            if (files["main.blocks"] && !pxt.blocks.loadWorkspaceXml(files["main.blocks"], true)) {
                // block code seems invalid., reset blocks to force decompilation
                pxt.log('invalid blockly xml, reseting blockly');
                files["main.blocks"] = '';
            }
            workspace.installAsync(h, files)
                .done(hd => this.loadHeaderAsync(hd));
            return;
        }

        core.warningNotification(lf("Sorry, we could not import this project."))
        pxt.tickEvent("warning.importfailed");
    }

    importProjectFile(file: File) {
        if (!file) return;

        fileReadAsBufferAsync(file)
            .then(buf => pxt.lzmaDecompressAsync(buf))
            .done(contents => {
                let data = JSON.parse(contents) as pxt.cpp.HexFile;
                this.importHex(data);
            }, e => {
                core.warningNotification(lf("Sorry, we could not import this project."))
            });
    }

    importFile(file: File) {
        if (!file) return;
        if (isHexFile(file.name)) {
            this.importHexFile(file)
        } else if (isBlocksFile(file.name)) {
            this.importBlocksFiles(file)
        } else if (isTypescriptFile(file.name)) {
            this.importTypescriptFile(file);
        } else if (isProjectFile(file.name)) {
            this.importProjectFile(file);
        } else core.warningNotification(lf("Oops, don't know how to load this file!"));
    }

    initDragAndDrop() {
        draganddrop.setupDragAndDrop(document.body,
            file => file.size < 1000000 && isHexFile(file.name) || isBlocksFile(file.name),
            files => {
                if (files) {
                    pxt.tickEvent("dragandrop.open")
                    this.importFile(files[0]);
                }
            }
        );
    }

    openProject() {
        pxt.tickEvent("menu.open");
        this.scriptSearch.showOpenProject();
    }

    exportProjectToFileAsync(): Promise<Uint8Array> {
        const mpkg = pkg.mainPkg;
        return this.saveFileAsync()
            .then(() => mpkg.filesToBePublishedAsync(true))
            .then(files => {
                const project: pxt.cpp.HexFile = {
                    meta: {
                        cloudId: pxt.CLOUD_ID + pxt.appTarget.id,
                        targetVersions: pxt.appTarget.versions,
                        editor: this.getPreferredEditor(),
                        name: mpkg.config.name
                    },
                    source: JSON.stringify(files, null, 2)
                }
                return pxt.lzmaCompressAsync(JSON.stringify(project, null, 2));
            });
    }

    getPreferredEditor(): string {
        return this.editor == this.blocksEditor ? pxt.BLOCKS_PROJECT_NAME : pxt.JAVASCRIPT_PROJECT_NAME;
    }

    exportAsync(): Promise<string> {
        pxt.debug("exporting project");
        return this.exportProjectToFileAsync()
            .then((buf) => {
                return window.btoa(Util.uint8ArrayToString(buf));
            });
    }

    importProjectFromFileAsync(buf: Uint8Array): Promise<void> {
        return pxt.lzmaDecompressAsync(buf)
            .then((project) => {
                let hexFile = JSON.parse(project) as pxt.cpp.HexFile;
                return this.importHex(hexFile);
            }).catch(() => {
                return this.newEmptyProject();
            })
    }

    saveProjectToFile() {
        const mpkg = pkg.mainPkg
        this.exportProjectToFileAsync()
            .done((buf: Uint8Array) => {
                const fn = pkg.genFileName(".pxt");
                pxt.BrowserUtils.browserDownloadUInt8Array(buf, fn, 'application/octet-stream');
            })
    }

    launchFullEditor() {
        Util.assert(sandbox);

        let rootUrl = pxt.appTarget.appTheme.embedUrl;
        if (!/\/$/.test(rootUrl)) rootUrl += '/';

        this.exportAsync()
            .then(fileContent => {
                pxt.tickEvent("sandbox.openfulleditor");
                const editUrl = `${rootUrl}#project:${fileContent}`;
                window.open(editUrl, '_blank')
            })
    }

    addPackage() {
        pxt.tickEvent("menu.addpackage");
        this.scriptSearch.showAddPackages();
    }

    newEmptyProject(name?: string, documentation?: string) {
        this.newProject({
            filesOverride: { "main.blocks": `<xml xmlns="http://www.w3.org/1999/xhtml"><block type="${ts.pxtc.ON_START_TYPE}"></block></xml>` },
            name, documentation
        })
    }

    newProject(options: ProjectCreationOptions = {}) {
        pxt.tickEvent("menu.newproject");
        core.showLoading(lf("creating new project..."));
        this.createProjectAsync(options)
            .then(() => Promise.delay(500))
            .done(() => core.hideLoading());
    }

    createProjectAsync(options: ProjectCreationOptions): Promise<void> {
        this.setSideDoc(undefined);
        if (!options.prj) options.prj = pxt.appTarget.blocksprj;
        let cfg = pxt.U.clone(options.prj.config);
        cfg.name = options.name || lf("Untitled") // pxt.U.fmt(cfg.name, Util.getAwesomeAdj());
        cfg.documentation = options.documentation;
        let files: ScriptText = Util.clone(options.prj.files)
        if (options.filesOverride)
            Util.jsonCopyFrom(files, options.filesOverride)
        files["pxt.json"] = JSON.stringify(cfg, null, 4) + "\n"
        return workspace.installAsync({
            name: cfg.name,
            meta: {},
            editor: options.prj.id,
            pubId: "",
            pubCurrent: false,
            target: pxt.appTarget.id,
            temporary: options.temporary
        }, files).then(hd => this.loadHeaderAsync(hd))
    }

    saveTypeScriptAsync(open = false): Promise<void> {
        if (!this.editor || !this.state.currFile || this.editorFile.epkg != pkg.mainEditorPkg() || this.reload)
            return Promise.resolve();

        let promise = Promise.resolve().then(() => {
            let src = this.editor.saveToTypeScript();

            if (!src) return Promise.resolve();
            // format before saving
            //src = pxtc.format(src, 0).formatted;

            let mainPkg = pkg.mainEditorPkg();
            let tsName = this.editorFile.getVirtualFileName();
            Util.assert(tsName != this.editorFile.name);
            return mainPkg.setContentAsync(tsName, src).then(() => {
                if (open) {
                    let f = mainPkg.files[tsName];
                    this.setFile(f);
                }
            });
        });

        if (open) {
            return core.showLoadingAsync(lf("switching to JavaScript..."), promise);
        } else {
            return promise;
        }
    }

    reset() {
        pxt.tickEvent("reset");
        core.confirmAsync({
            header: lf("Reset"),
            body: lf("You are about to clear all projects. Are you sure? This operation cannot be undone."),
            agreeLbl: lf("Reset"),
            agreeClass: "red",
            agreeIcon: "sign out",
            disagreeLbl: lf("Cancel")
        }).then(r => {
            if (!r) return;
            this.reload = true; //Indicate we are goint to reload next.
            workspace.resetAsync()
                .done(() => window.location.reload(),
                () => window.location.reload())
        });
    }

    compile(saveOnly = false) {
        // the USB init has to be called from an event handler
        if (/webusb=1/i.test(window.location.href)) {
            pxt.usb.initAsync().catch(e => { })
        }

        pxt.tickEvent("compile");
        pxt.debug('compiling...');
        if (this.state.compiling) {
            pxt.tickEvent("compile.double");
            return;
        }
        const simRestart = this.state.running;
        this.setState({ compiling: true });
        this.clearLog();
        this.editor.beforeCompile();
        if (simRestart) this.stopSimulator();
        let state = this.editor.snapshotState()
        compiler.compileAsync({ native: true, forceEmit: true, preferredEditor: this.getPreferredEditor() })
            .then(resp => {
                this.editor.setDiagnostics(this.editorFile, state)
                let fn = pxt.appTarget.compile.useUF2 ? pxtc.BINARY_UF2 : pxtc.BINARY_HEX;
                if (!resp.outfiles[fn]) {
                    pxt.tickEvent("compile.noemit")
                    core.warningNotification(lf("Compilation failed, please check your code for errors."));
                    return Promise.resolve()
                }
                resp.saveOnly = saveOnly
                return pxt.commands.deployCoreAsync(resp)
                    .catch(e => {
                        core.warningNotification(lf(".hex file upload failed, please try again."));
                        pxt.reportException(e);
                    })
            }).catch((e: Error) => {
                pxt.reportException(e);
                core.errorNotification(lf("Compilation failed, please contact support."));
            }).finally(() => {
                this.setState({ compiling: false });
                if (simRestart) this.runSimulator();
            })
            .done();
    }

    startStopSimulator() {
        if (this.state.running) {
            pxt.tickEvent('simulator.stop')
            this.stopSimulator()
        } else {
            pxt.tickEvent('simulator.start')
            this.startSimulator();
        }
    }

    restartSimulator() {
        pxt.tickEvent('simulator.restart')
        this.stopSimulator();
        this.startSimulator();
    }

    startSimulator() {
        pxt.tickEvent('simulator.start')
        this.saveFileAsync()
                .then(() => this.runSimulator());
    }

    stopSimulator(unload = false) {
        simulator.stop(unload)
        this.setState({ running: false })
    }

    openInstructions() {
        pxt.tickEvent("simulator.make");
        compiler.compileAsync({ native: true })
            .done(resp => {
                let p = pkg.mainEditorPkg();
                let code = p.files["main.ts"];
                let data: any = {
                    name: p.header.name || lf("Untitled"),
                    code: code ? code.content : `basic.showString("Hi!");`,
                    board: JSON.stringify(pxt.appTarget.simulator.boardDefinition)
                };
                let parts = ts.pxtc.computeUsedParts(resp);
                if (parts.length) {
                    data.parts = parts.join(" ");
                    data.partdefs = JSON.stringify(pkg.mainPkg.computePartDefinitions(parts));
                }
                let fnArgs = resp.usedArguments;
                if (fnArgs)
                    data.fnArgs = JSON.stringify(fnArgs);
                data.package = Util.values(pkg.mainPkg.deps).filter(p => p.id != "this").map(p => `${p.id}=${p._verspec}`).join('\n')
                let urlData = Object.keys(data).map(k => `${k}=${encodeURIComponent(data[k])}`).join('&');
                let url = `${pxt.webConfig.partsUrl}?${urlData}`
                window.open(url, '_blank')
            });
    }

    clearLog() {
        let logs = this.refs["logs"] as logview.LogView;
        logs.clear();
    }

    hwDebug() {
        let start = Promise.resolve()
        if (!this.state.running || !simulator.driver.runOptions.debug)
            start = this.runSimulator({ debug: true })
        return start.then(() => {
            simulator.driver.setHwDebugger({
                postMessage: (msg) => {
                    hwdbg.handleMessage(msg as pxsim.DebuggerMessage)
                }
            })
            hwdbg.postMessage = (msg) => simulator.driver.handleHwDebuggerMsg(msg)
            return hwdbg.startDebugAsync()
        })
    }

    runSimulator(opts: compiler.CompileOptions = {}) {
        const editorId = this.editor ? this.editor.getId().replace(/Editor$/, '') : "unknown";
        if (opts.background) pxt.tickActivity("autorun", "autorun." + editorId);
        else pxt.tickEvent(opts.debug ? "debug" : "run", { editor: editorId });

        if (opts.background) {
            if (!simulator.isDirty()) {
                pxt.debug('auto-run cancelled');
                return;
            }
        } else {
            this.editor.beforeCompile();
        }

        this.stopSimulator();
        this.clearLog();

        let state = this.editor.snapshotState()
        return compiler.compileAsync(opts)
            .then(resp => {
                this.editor.setDiagnostics(this.editorFile, state)
                if (resp.outfiles[pxtc.BINARY_JS]) {
                    simulator.run(pkg.mainPkg, opts.debug, resp)
                    this.setState({ running: true, showParts: simulator.driver.runOptions.parts.length > 0 })
                } else if (!opts.background) {
                    core.warningNotification(lf("Oops, we could not run this project. Please check your code for errors."))
                }
            })
    }

    editText() {
        if (this.editor != this.textEditor) {
            this.updateEditorFile(this.textEditor)
            this.forceUpdate();
        }
    }

    importFileDialog() {
        let input: HTMLInputElement;
        core.confirmAsync({
            header: lf("Open .hex file"),
            onLoaded: ($el) => {
                input = $el.find('input')[0] as HTMLInputElement;
            },
            htmlBody: `<div class="ui form">
  <div class="ui field">
    <label>${lf("Select a .hex file to open.")}</label>
    <input type="file" class="ui button blue fluid"></input>
  </div>
</div>`,
        }).done(res => {
            if (res) {
                pxt.tickEvent("menu.open.file");
                this.importFile(input.files[0]);
            }
        })
    }

    publishAsync(): Promise<string> {
        pxt.tickEvent("publish");
        this.setState({ publishing: true })
        let mpkg = pkg.mainPkg
        let epkg = pkg.getEditorPkg(mpkg)
        return this.saveFileAsync()
            .then(() => mpkg.filesToBePublishedAsync(true))
            .then(files => {
                if (epkg.header.pubCurrent)
                    return Promise.resolve(epkg.header.pubId)
                let meta: workspace.ScriptMeta = {
                    description: mpkg.config.description,
                    islibrary: false,
                }
                let blocksSize = this.blocksEditor.contentSize();
                if (blocksSize) {
                    meta.blocksHeight = blocksSize.height;
                    meta.blocksWidth = blocksSize.width;
                }
                return workspace.publishAsync(epkg.header, files, meta)
                    .then(inf => inf.id)
            }).finally(() => {
                this.setState({ publishing: false })
            })
            .catch(e => {
                core.errorNotification(e.message)
                return undefined;
            })
    }

    private debouncedSaveProjectName = Util.debounce(() => {
        this.saveProjectName();
    }, 2000, false);

    updateHeaderName(name: string) {
        this.setState({
            projectName: name
        })
        this.debouncedSaveProjectName();
    }

    saveProjectName() {
        if (!this.state.projectName || !this.state.header) return;

        pxt.debug('saving project name to ' + this.state.projectName);
        try {
            //Save the name in the target MainPackage as well
            pkg.mainPkg.config.name = this.state.projectName;

            let f = pkg.mainEditorPkg().lookupFile("this/" + pxt.CONFIG_NAME);
            let config = JSON.parse(f.content) as pxt.PackageConfig;
            config.name = this.state.projectName;
            f.setContentAsync(JSON.stringify(config, null, 4) + "\n").done(() => {
                if (this.state.header)
                    this.setState({
                        projectName: this.state.header.name
                    })
            });
        }
        catch (e) {
            console.error('failed to read pxt.json')
        }
    }

    about() {
        pxt.tickEvent("menu.about");
        core.confirmAsync({
            header: lf("About {0}", pxt.appTarget.name),
            hideCancel: true,
            agreeLbl: lf("Ok"),
            htmlBody: `
<p>${Util.htmlEscape(pxt.appTarget.name)} version: <a href="${Util.htmlEscape(pxt.appTarget.appTheme.githubUrl)}/releases/tag/${Util.htmlEscape(pxt.appTarget.versions.tag)}">${Util.htmlEscape(pxt.appTarget.versions.target)}</a></p>
<p>PXT version: <a href="https://github.com/Microsoft/pxt/releases/tag/v${Util.htmlEscape(pxt.appTarget.versions.pxt)}">${Util.htmlEscape(pxt.appTarget.versions.pxt)}</a></p>
<p>${Util.htmlEscape(pxt.appTarget.description)}</p>
`
        }).done();
    }

    embed() {
        pxt.tickEvent("menu.embed");
        const header = this.state.header;
        this.shareEditor.show(header);
    }

    gettingStarted() {
        pxt.tickEvent("btn.gettingstarted");
        const targetTheme = pxt.appTarget.appTheme;
        Util.assert(!this.state.sideDocsLoadUrl && targetTheme && !!targetTheme.sideDoc);
        this.startTutorial(targetTheme.sideDoc);
    }

    startTutorial(tutorialId: string) {
        pxt.tickEvent("tutorial.start");
        core.showLoading(lf("starting tutorial..."));
        this.startTutorialAsync(tutorialId)
            .then(() => Promise.delay(500));
    }

    startTutorialAsync(tutorialId: string): Promise<void> {
        let title = tutorialId;
        let result: string[] = [];

        return pxt.Cloud.downloadMarkdownAsync(tutorialId)
            .then(md => {
                let titleRegex = /^#(.*)/g.exec(md);
                if (!titleRegex || titleRegex.length < 1) return;
                title = titleRegex[1];

                let steps = md.split('###');
                for (let step = 1; step < steps.length; step++) {
                    let stepmd = `###${steps[step]}`;
                    result.push(stepmd);
                }
                //TODO: parse for tutorial options, mainly initial blocks
            }).then(() => {
                this.setState({ tutorial: tutorialId, tutorialName: title, tutorialStep: 0, tutorialSteps: result })
                let tc = this.refs["tutorialcard"] as TutorialCard;
                tc.setPath(tutorialId);
            }).then(() => {
                return this.createProjectAsync({
                    filesOverride: {
                        "main.blocks": "<xml xmlns=\"http://www.w3.org/1999/xhtml\">",
                        "main.ts": "  "
                    },
                    name: tutorialId,
                    temporary: true
                });
            });
    }

    exitTutorial() {
        pxt.tickEvent("tutorial.exit");
        core.showLoading(lf("exiting tutorial..."));
        this.exitTutorialAsync()
            .then(() => Promise.delay(500))
            .done(() => core.hideLoading());
    }

    exitTutorialAsync() {
        // tutorial project is temporary, no need to delete
        let curr = pkg.mainEditorPkg().header
        curr.isDeleted = true
        return workspace.saveAsync(curr, {})
            .then(() => {
                if (workspace.getHeaders().length > 0) {
                    this.loadHeaderAsync(workspace.getHeaders()[0]);
                } else {
                    this.newProject();
                }
            }).finally(() => {
                this.setState({ tutorial: null, tutorialName: null, tutorialSteps: null, tutorialStep: -1 });
            });
    }

    getSandboxMode() {
        return sandbox;
    }

    renderCore() {
        theEditor = this;

        if (this.editor && this.editor.isReady) {
            this.updateEditorFile();
        }

        //  ${targetTheme.accentColor ? "inverted accent " : ''}
        const settings: Cloud.UserSettings = (Cloud.isLoggedIn() ? this.getData("cloud:me/settings?format=nonsensitive") : {}) || {}
        const targetTheme = pxt.appTarget.appTheme;
        const workspaces = pxt.appTarget.cloud && pxt.appTarget.cloud.workspaces;
        const packages = pxt.appTarget.cloud && pxt.appTarget.cloud.packages;
        const sharingEnabled = pxt.appTarget.cloud && pxt.appTarget.cloud.sharing;
        const compile = pxt.appTarget.compile;
        const compileBtn = compile.hasHex;
        const simOpts = pxt.appTarget.simulator;
        const make = !sandbox && this.state.showParts && simOpts && (simOpts.instructions || (simOpts.parts && pxt.options.debug));
        const rightLogo = sandbox ? targetTheme.portraitLogo : targetTheme.rightLogo;
        const compileTooltip = lf("Download your code to the {0}", targetTheme.boardName);
        const compileLoading = !!this.state.compiling;
        const runTooltip = this.state.running ? lf("Stop the simulator") : lf("Start the simulator");
        const makeTooltip = lf("Open assembly instructions");
        const restartTooltip = lf("Restart the simulator");
        const isBlocks = !this.editor.isVisible || this.getPreferredEditor() == pxt.BLOCKS_PROJECT_NAME;
        const sideDocs = !(sandbox || pxt.options.light || targetTheme.hideSideDocs);
        const tutorial = this.state.tutorial;
        const docMenu = targetTheme.docMenu && targetTheme.docMenu.length && !sandbox && !tutorial;
        const gettingStarted = !sandbox && !tutorial && !this.state.sideDocsLoadUrl && targetTheme && targetTheme.sideDoc && isBlocks;
        const gettingStartedTooltip = lf("Open beginner tutorial");
        const run = true; // !compileBtn || !pxt.appTarget.simulator.autoRun || !isBlocks;
        const blockActive = this.editor == this.blocksEditor
            && this.editorFile && this.editorFile.name == "main.blocks";
        const javascriptActive = this.editor == this.textEditor
            && this.editorFile && this.editorFile.name == "main.ts";
        const blocksClick = () => {
            pxt.tickEvent("menu.blocks");
            if (blockActive) return;
            if (javascriptActive) this.textEditor.openBlocks();
            else this.setFile(pkg.mainEditorPkg().files["main.blocks"])
        }
        const javascriptClick = () => {
            pxt.tickEvent("menu.javascript");
            if (javascriptActive) return;
            if (blockActive) this.blocksEditor.openTypeScript();
            else this.setFile(pkg.mainEditorPkg().files["main.ts"])
        }

        // update window title
        document.title = this.state.header ? `${this.state.header.name} - ${pxt.appTarget.name}` : pxt.appTarget.name;

        return (
            <div id='root' className={`full-abs ${this.state.hideEditorFloats || this.state.collapseEditorTools ? " hideEditorFloats" : ""} ${this.state.collapseEditorTools ? " collapsedEditorTools" : ""} ${!sideDocs || !this.state.sideDocsLoadUrl || this.state.sideDocsCollapsed ? "" : "sideDocs"} ${sandbox ? "sandbox" : ""} ${tutorial ? "tutorial" : ""} ${pxt.options.light ? "light" : ""}` }>
                <div id="menubar" role="banner">
                    <div className={`ui borderless fixed ${targetTheme.invertedMenu ? `inverted` : ''} menu`} role="menubar">
                        {sandbox ? undefined :
                            <span id="logo" className="ui item logo">
                                {targetTheme.logo || targetTheme.portraitLogo
                                    ? <a className="ui image" target="_blank" href={targetTheme.logoUrl}><img className={`ui logo ${targetTheme.portraitLogo ? " portrait hide" : ''}`} src={Util.toDataUri(targetTheme.logo || targetTheme.portraitLogo) } /></a>
                                    : <span className="name">{targetTheme.name}</span>}
                                {targetTheme.portraitLogo ? (<a className="ui image" target="_blank" href={targetTheme.logoUrl}><img className='ui logo portrait only' src={Util.toDataUri(targetTheme.portraitLogo) } /></a>) : null }
                            </span> }
                        {sandbox ? undefined : <div className="ui item landscape only"></div>}
                        {sandbox ? undefined : <div className="ui item landscape only"></div>}
                        {sandbox ? undefined : <div className="ui item widedesktop only"></div>}
                        {sandbox ? undefined : <div className="ui item widedesktop only"></div>}
                        {sandbox || tutorial ? undefined : <sui.Item class="openproject" role="menuitem" textClass="landscape only" icon="folder open" text={lf("Projects") } onClick={() => this.openProject() } />}
                        {tutorial ? undefined : <sui.Item class="editor-menuitem">
                            <sui.Item class="blocks-menuitem" textClass="landscape only" text={lf("Blocks") } icon="puzzle" active={blockActive} onClick={blocksClick} title={lf("Convert code to Blocks") } />
                            <sui.Item class="javascript-menuitem" textClass="landscape only" text={lf("JavaScript") } icon="align left" active={javascriptActive} onClick={javascriptClick} title={lf("Convert code to JavaScript") } />
                        </sui.Item> }
                        {docMenu ? <DocsMenuItem parent={this} /> : undefined}
                        {sandbox || tutorial ? undefined : <sui.DropdownMenuItem icon='setting' title={lf("More...") } class="more-dropdown-menuitem">
                            {this.state.header ? <sui.Item role="menuitem" icon="options" text={lf("Rename...") } onClick={() => this.setFile(pkg.mainEditorPkg().lookupFile("this/pxt.json")) } /> : undefined}
                            {this.state.header && packages && sharingEnabled ? <sui.Item role="menuitem" text={lf("Embed Project...") } icon="share alternate" onClick={() => this.embed() } /> : null}
                            {this.state.header && packages ? <sui.Item role="menuitem" icon="disk outline" text={lf("Add Package...") } onClick={() => this.addPackage() } /> : undefined }
                            {this.state.header ? <sui.Item role="menuitem" icon="trash" text={lf("Delete Project") } onClick={() => this.removeProject() } /> : undefined }
                            <div className="ui divider"></div>
                            <a className="ui item thin only" href="/docs" role="menuitem" target="_blank">
                                <i className="help icon"></i>
                                {lf("Help") }
                            </a>
                            {
                                // we always need a way to clear local storage, regardless if signed in or not
                            }
                            <sui.Item role="menuitem" icon='sign out' text={lf("Reset") } onClick={() => this.reset() } />
                            <div className="ui divider"></div>
                            { targetTheme.privacyUrl ? <a className="ui item" href={targetTheme.privacyUrl} role="menuitem" title={lf("Privacy & Cookies") } target="_blank">{lf("Privacy & Cookies") }</a> : undefined }
                            { targetTheme.termsOfUseUrl ? <a className="ui item" href={targetTheme.termsOfUseUrl} role="menuitem" title={lf("Terms Of Use") } target="_blank">{lf("Terms Of Use") }</a> : undefined }
                            <sui.Item role="menuitem" text={lf("About...") } onClick={() => this.about() } />
                            { electron.isElectron ? <sui.Item role="menuitem" text={lf("Check for updates...") } onClick={() => electron.checkForUpdate() } /> : undefined }
                        </sui.DropdownMenuItem>}
                        <div className="right menu">
                            {sandbox ? <sui.Item role="menuitem" icon="external" text={lf("Open with {0}", targetTheme.name) } textClass="landscape only" onClick={() => this.launchFullEditor() }/> : undefined }
                            {sandbox ? <span className="ui item logo"><img className="ui image" src={Util.toDataUri(rightLogo) } /></span> : undefined }
                            {!sandbox && gettingStarted ? <span className="ui item"><sui.Button class="tablet only small getting-started-btn" title={gettingStartedTooltip} text={lf("Getting Started") } onClick={() => this.gettingStarted() } /></span> : undefined }
                        </div>
                        {tutorial ? <TutorialMenuItem parent={this} /> : undefined }
                        {tutorial ? <div className="right menu">
                            <sui.Item role="menuitem" icon="external" text={lf("Exit tutorial") } textClass="landscape only" onClick={() => this.exitTutorial() }/>
                            <div className="ui item widedesktop only"></div>
                            <div className="ui item widedesktop only"></div>
                            <div className="ui item widedesktop only"></div>
                            <div className="ui item widedesktop only"></div>
                            <div className="ui item widedesktop only"></div>
                            <div className="ui item widedesktop only"></div>
                        </div> : undefined }
                    </div>
                </div>
                {gettingStarted ?
                    <div id="getting-started-btn">
                        <sui.Button class="portrait hide bottom attached small getting-started-btn" title={gettingStartedTooltip} text={lf("Getting Started") } onClick={() => this.gettingStarted() } />
                    </div>
                    : undefined }
                <div id="simulator">
                    <div id="filelist" className="ui items" role="complementary">
                        <div id="boardview" className={`ui vertical editorFloat`}>
                        </div>
                        <div className="ui item grid centered portrait hide simtoolbar">
                            <div className="ui icon buttons">
                                {make ? <sui.Button icon='configure' class="fluid sixty secondary" text={lf("Make") } title={makeTooltip} onClick={() => this.openInstructions() } /> : undefined }
                                {run ? <sui.Button key='runbtn' class={`${compileBtn ? '' : 'huge fluid'} play-button`} text={compileBtn ? undefined : this.state.running ? lf("Stop") : lf("Run") } icon={this.state.running ? "stop" : "play"} title={runTooltip} onClick={() => this.startStopSimulator() } /> : undefined }
                                {run ? <sui.Button key='restartbtn' class={`${compileBtn ? '' : 'huge fluid'} restart-button`} text={compileBtn ? undefined : lf("Restart") } icon="refresh" title={restartTooltip} onClick={() => this.restartSimulator() } /> : undefined }
                            </div>
                        </div>
                        <div className="ui item portrait hide">
                            {pxt.options.debug && !this.state.running ? <sui.Button key='debugbtn' class='teal' icon="xicon bug" text={"Sim Debug"} onClick={() => this.runSimulator({ debug: true }) } /> : ''}
                            {pxt.options.debug ? <sui.Button key='hwdebugbtn' class='teal' icon="xicon chip" text={"Dev Debug"} onClick={() => this.hwDebug() } /> : ''}
                        </div>
                        <div className="ui editorFloat portrait hide">
                            <logview.LogView ref="logs" />
                        </div>
                        {sandbox || isBlocks ? undefined : <FileList parent={this} />}
                    </div>
                </div>
                <div id="maineditor" className={sandbox ? "sandbox" : ""} role="main">
                    {tutorial ? <TutorialCard ref="tutorialcard" parent={this} /> : undefined }
                    {this.allEditors.map(e => e.displayOuter()) }
                </div>
                <div id="editortools" role="complementary">
                    <EditorTools ref="editortools" parent={this} />
                </div>
                {sideDocs ? <SideDocs ref="sidedoc" parent={this} /> : undefined}
                {!sandbox && targetTheme.organizationWideLogo && targetTheme.organizationLogo ? <div><img className="organization ui landscape hide" src={Util.toDataUri(targetTheme.organizationLogo) } /> <img className="organization ui landscape only" src={Util.toDataUri(targetTheme.organizationWideLogo) } /></div> : undefined}
                {!sandbox && !targetTheme.organizationWideLogo && targetTheme.organizationLogo ? <img className="organization" src={Util.toDataUri(targetTheme.organizationLogo) } /> : undefined}
                {sandbox ? undefined : <ScriptSearch parent={this} ref={v => this.scriptSearch = v} />}
                {sandbox || !sharingEnabled ? undefined : <ShareEditor parent={this} ref={v => this.shareEditor = v} />}
                {sandbox ? <div className="ui horizontal small divided link list sandboxfooter">
                    {targetTheme.organizationUrl && targetTheme.organization ? <a className="item" target="_blank" href={targetTheme.organizationUrl}>{lf("Powered by {0}", targetTheme.organization) }</a> : undefined}
                    <a target="_blank" className="item" href={targetTheme.termsOfUseUrl}>{lf("Terms of Use") }</a>
                    <a target="_blank" className="item" href={targetTheme.privacyUrl}>{lf("Privacy") }</a>
                </div> : undefined }
            </div>
        );
    }
}


function render() {
    ReactDOM.render(<ProjectView/>, $('#content')[0])
}

function getEditor() {
    return theEditor
}

function isHexFile(filename: string): boolean {
    return /\.(hex|uf2)$/i.test(filename)
}

function isBlocksFile(filename: string): boolean {
    return /\.blocks$/i.test(filename)
}

function isTypescriptFile(filename: string): boolean {
    return /\.ts$/i.test(filename);
}

function isProjectFile(filename: string): boolean {
    return /\.pxt$/i.test(filename)
}

function fileReadAsBufferAsync(f: File): Promise<Uint8Array> { // ArrayBuffer
    if (!f)
        return Promise.resolve<Uint8Array>(null);
    else {
        return new Promise<Uint8Array>((resolve, reject) => {
            let reader = new FileReader();
            reader.onerror = (ev) => resolve(null);
            reader.onload = (ev) => resolve(new Uint8Array(reader.result as ArrayBuffer));
            reader.readAsArrayBuffer(f);
        });
    }
}

function fileReadAsTextAsync(f: File): Promise<string> { // ArrayBuffer
    if (!f)
        return Promise.resolve<string>(null);
    else {
        return new Promise<string>((resolve, reject) => {
            let reader = new FileReader();
            reader.onerror = (ev) => resolve(null);
            reader.onload = (ev) => resolve(reader.result);
            reader.readAsText(f);
        });
    }
}

function initLogin() {
    {
        let qs = core.parseQueryString((location.hash || "#").slice(1).replace(/%23access_token/, "access_token"))
        if (qs["access_token"]) {
            let ex = pxt.storage.getLocal("oauthState")
            if (ex && ex == qs["state"]) {
                pxt.storage.setLocal("access_token", qs["access_token"])
                pxt.storage.removeLocal("oauthState")
            }
            location.hash = location.hash.replace(/(%23)?[\#\&\?]*access_token.*/, "")
        }
        Cloud.accessToken = pxt.storage.getLocal("access_token") || "";
    }

    {
        let qs = core.parseQueryString((location.hash || "#").slice(1).replace(/%local_token/, "local_token"))
        if (qs["local_token"]) {
            pxt.storage.setLocal("local_token", qs["local_token"])
            location.hash = location.hash.replace(/(%23)?[\#\&\?]*local_token.*/, "")
        }
        Cloud.localToken = pxt.storage.getLocal("local_token") || "";
    }
}

function initSerial() {
    if (!pxt.appTarget.serial || !Cloud.isLocalHost() || !Cloud.localToken)
        return;

    if (hidbridge.shouldUse()) {
        hidbridge.initAsync()
            .then(dev => {
                dev.onSerial = (buf, isErr) => {
                    window.postMessage({
                        type: 'serial',
                        id: 'n/a', // TODO
                        data: Util.fromUTF8(Util.uint8ArrayToString(buf))
                    }, "*")
                }
            })
        return
    }

    pxt.debug('initializing serial pipe');
    let ws = new WebSocket(`ws://localhost:${pxt.options.wsPort}/${Cloud.localToken}/serial`);
    ws.onopen = (ev) => {
        pxt.debug('serial: socket opened');
    }
    ws.onclose = (ev) => {
        pxt.debug('serial: socket closed')
    }
    ws.onmessage = (ev) => {
        try {
            let msg = JSON.parse(ev.data) as pxsim.SimulatorMessage;
            if (msg && msg.type == 'serial')
                window.postMessage(msg, "*")
        }
        catch (e) {
            pxt.debug('unknown message: ' + ev.data);
        }
    }
}

function getsrc() {
    pxt.log(theEditor.editor.getCurrentSource())
}

function initScreenshots() {
    window.addEventListener('message', (ev: MessageEvent) => {
        let msg = ev.data as pxsim.SimulatorMessage;
        if (msg && msg.type == "screenshot") {
            pxt.tickEvent("sim.screenshot");
            const scmsg = msg as pxsim.SimulatorScreenshotMessage;
            console.log('received screenshot');
            screenshot.saveAsync(theEditor.state.header, scmsg.data)
                .done(() => { pxt.debug('screenshot saved') })
        };
    }, false);
}

function enableAnalytics() {
    pxt.analytics.enable();
    const stats: pxt.Map<string | number> = {}
    if (typeof window !== "undefined") {
        const screen = window.screen;
        stats["screen.width"] = screen.width;
        stats["screen.width"] = screen.height;
        stats["screen.availwidth"] = screen.availWidth;
        stats["screen.availheight"] = screen.availHeight;
        stats["screen.devicepixelratio"] = pxt.BrowserUtils.devicePixelRatio();
    }
    pxt.tickEvent("editor.loaded", stats);
}

function showIcons() {
    let usedIcons = [
        "cancel", "certificate", "checkmark", "cloud", "cloud upload", "copy", "disk outline", "download",
        "dropdown", "edit", "file outline", "find", "folder", "folder open", "help circle",
        "keyboard", "lock", "play", "puzzle", "search", "setting", "settings",
        "share alternate", "sign in", "sign out", "square", "stop", "translate", "trash", "undo", "upload",
        "user", "wizard", "configure", "align left"
    ]
    core.confirmAsync({
        header: "Icons",
        htmlBody:
        usedIcons.map(s => `<i style='font-size:2em' class="ui icon ${s}"></i>&nbsp;${s}&nbsp; `).join("\n")
    })
}

function assembleCurrent() {
    compiler.compileAsync({ native: true })
        .then(() => compiler.assembleAsync(getEditor().editorFile.content))
        .then(v => {
            let nums = v.words
            pxt.debug("[" + nums.map(n => "0x" + n.toString(16)).join(",") + "]")
        })
}

function log(v: any) {
    console.log(v)
}

// This is for usage from JS console
let myexports: any = {
    workspace,
    require,
    core,
    getEditor,
    monaco,
    blocks,
    compiler,
    pkg,
    getsrc,
    sim: simulator,
    apiAsync: core.apiAsync,
    showIcons,
    hwdbg,
    assembleCurrent,
    log
};
(window as any).E = myexports;

export var ksVersion: string;
export var sandbox = false;

function initTheme() {
    core.cookieNotification()

    const theme = pxt.appTarget.appTheme;
    if (theme.accentColor) {
        let style = document.createElement('style');
        style.type = 'text/css';
        style.innerHTML = `.ui.accent { color: ${theme.accentColor}; }
        .ui.inverted.menu .accent.active.item, .ui.inverted.accent.menu  { background-color: ${theme.accentColor}; }`;
        document.getElementsByTagName('head')[0].appendChild(style);
    }
    // RTL languages
    if (/^ar/i.test(Util.userLanguage())) {
        pxt.debug("rtl layout");
        pxsim.U.addClass(document.body, "rtl");
        document.body.style.direction = "rtl";
    }

    function patchCdn(url: string): string {
        if (!url) return url;
        return url.replace("@pxtCdnUrl@", pxt.getOnlineCdnUrl())
            .replace("@cdnUrl@", pxt.getOnlineCdnUrl());
    }

    theme.appLogo = patchCdn(theme.appLogo)
    theme.cardLogo = patchCdn(theme.cardLogo)
    for (const u of theme.usbHelp || [])
        u.path = patchCdn(u.path)

}

function parseHash(): { cmd: string; arg: string } {
    let hashCmd = ""
    let hashArg = ""
    let hashM = /^#(\w+)(:([\/\-\+\=\w]+))?$/.exec(window.location.hash)
    if (hashM) {
        return { cmd: hashM[1], arg: hashM[3] || '' };
    }
    return { cmd: '', arg: '' };
}

function handleHash(hash: { cmd: string; arg: string }) {
    if (!hash) return;
    let editor = theEditor;
    if (!editor) return;
    switch (hash.cmd) {
        case "doc":
            pxt.tickEvent("hash.doc")
            editor.setSideDoc(hash.arg);
            break;
        case "follow":
            pxt.tickEvent("hash.follow")
            editor.newEmptyProject(undefined, hash.arg);
            break;
        case "newproject":
            pxt.tickEvent("hash.newproject")
            editor.newEmptyProject();
            break;
        case "gettingstarted":
            pxt.tickEvent("hash.gettingstarted")
            editor.newProject();
            break;
        case "tutorial":
            pxt.tickEvent("hash.tutorial")
            editor.startTutorial(hash.arg);
            break;
        case "sandbox":
        case "pub":
        case "edit":
            pxt.tickEvent("hash." + hash.cmd);
            let existing = workspace.getHeaders()
                .filter(h => h.pubCurrent && h.pubId == hash.arg)[0]
            core.showLoading(lf("loading project..."));
            (existing
                ? theEditor.loadHeaderAsync(existing)
                : workspace.installByIdAsync(hash.arg)
                    .then(hd => theEditor.loadHeaderAsync(hd)))
                .done(() => core.hideLoading())
            break;
        case "sandboxproject":
        case "project":
            pxt.tickEvent("hash." + hash.cmd);
            let fileContents = Util.stringToUint8Array(atob(hash.arg));
            core.showLoading(lf("loading project..."));
            theEditor.importProjectFromFileAsync(fileContents)
                .done(() => core.hideLoading())
            break;
    }
}

function initHashchange() {
    window.addEventListener("hashchange", e => {
        handleHash(parseHash());
    });
}

$(document).ready(() => {
    pxt.setupWebConfig((window as any).pxtConfig);
    const config = pxt.webConfig
    sandbox = /sandbox=1|#sandbox|#sandboxproject/i.test(window.location.href)
        // in iframe
        || pxt.BrowserUtils.isIFrame();
    pxt.options.debug = /dbg=1/i.test(window.location.href);
    pxt.options.light = /light=1/i.test(window.location.href) || pxt.BrowserUtils.isARM() || pxt.BrowserUtils.isIE();

    const wsPortMatch = /ws=(\d+)/i.exec(window.location.href);

    if (wsPortMatch) {
        pxt.options.wsPort = parseInt(wsPortMatch[1]) || 3233;
        window.location.hash = window.location.hash.replace(wsPortMatch[0], "");
    } else {
        pxt.options.wsPort = 3233;
    }

    enableAnalytics()
    appcache.init();
    initLogin();

    let hash = parseHash();

    let hm = /^(https:\/\/[^/]+)/.exec(window.location.href)
    if (hm) Cloud.apiRoot = hm[1] + "/api/"

    let ws = /ws=(\w+)/.exec(window.location.href)
    if (ws) workspace.setupWorkspace(ws[1]);
    else if (sandbox) workspace.setupWorkspace("mem");
    else if (Cloud.isLocalHost()) workspace.setupWorkspace("fs");

    pxt.docs.requireMarked = () => require("marked");

    const ih = (hex: pxt.cpp.HexFile) => theEditor.importHex(hex);
    const cfg = pxt.webConfig;

    pkg.setupAppTarget((window as any).pxtTargetBundle)

    if (!pxt.BrowserUtils.isBrowserSupported()) {
        let redirect = pxt.BrowserUtils.suggestedBrowserPath();
        if (redirect) {
            window.location.href = redirect;
        }
    }

    Promise.resolve()
        .then(() => {
            const mlang = /(live)?lang=([a-z]{2,}(-[A-Z]+)?)/i.exec(window.location.href);
            const lang = mlang ? mlang[2] : (pxt.appTarget.appTheme.defaultLocale || navigator.userLanguage || navigator.language);
            const live = mlang && !!mlang[1];
            if (lang) pxt.tickEvent("locale." + lang + (live ? ".live" : ""));
            return Util.updateLocalizationAsync(cfg.pxtCdnUrl, lang, live);
        })
        .then(() => initTheme())
        .then(() => cmds.initCommandsAsync())
        .then(() => {
            if (localStorage["noAutoRun"] && pxt.appTarget.simulator)
                pxt.appTarget.simulator.autoRun = false
        })
        .then(() => compiler.init())
        .then(() => workspace.initAsync())
        .then(() => {
            $("#loading").remove();
            render()
            return workspace.syncAsync();
        })
        .then(() => {
            initSerial();
            initScreenshots();
            initHashchange();
        }).then(() => pxt.winrt.initAsync(ih))
        .then(() => {
            electron.init();
            switch (hash.cmd) {
                case "sandbox":
                case "pub":
                case "edit":
                    let existing = workspace.getHeaders().filter(h => h.pubCurrent && h.pubId == hash.arg)[0]
                    if (existing)
                        return theEditor.loadHeaderAsync(existing)
                    else return workspace.installByIdAsync(hash.arg)
                        .then(hd => theEditor.loadHeaderAsync(hd))
                case "project":
                    let fileContents = Util.stringToUint8Array(atob(hash.arg));
                    return theEditor.importProjectFromFileAsync(fileContents);
                default:
                    handleHash(hash); break;
            }

            let ent = theEditor.settings.fileHistory.filter(e => !!workspace.getHeader(e.id))[0]
            let hd = workspace.getHeaders()[0]
            if (ent)
                hd = workspace.getHeader(ent.id)
            if (hd) return theEditor.loadHeaderAsync(hd)
            else theEditor.newProject();
            return Promise.resolve();
        }).done(() => { });

    document.addEventListener("visibilitychange", ev => {
        if (theEditor)
            theEditor.updateVisibility();
    });

    window.addEventListener("unload", ev => {
        if (theEditor)
            theEditor.saveSettings()
    });
    window.addEventListener("resize", ev => {
        if (theEditor && theEditor.editor)
            theEditor.editor.resize(ev)
    }, false);
    window.addEventListener("message", ev => {
        let m = ev.data as pxsim.SimulatorMessage;
        if (!m) {
            return;
        }
        if (m.type == "tutorial") {
            if (theEditor && theEditor.editor)
                theEditor.handleMessage(m);
        }
        if (m.type === "sidedocready" && Cloud.isLocalHost() && Cloud.localToken) {
            SideDocs.notify({
                type: "localtoken",
                localToken: Cloud.localToken
            } as pxsim.SimulatorDocMessage);
            TutorialContent.notify({
                type: "localtoken",
                localToken: Cloud.localToken
            } as pxsim.SimulatorDocMessage);
        }
    }, false);
})
