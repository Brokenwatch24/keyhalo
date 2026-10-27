import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  CircleCheck,
  Copy,
  Download,
  FlaskConical,
  Keyboard,
  LifeBuoy,
  Loader2,
  Play,
  Save,
  Share2,
  SkipForward,
  Square,
  Undo2,
  Usb,
  Wand2,
} from "lucide-react";
import { Badge, Button, Card, Field, Input, KeyboardView, Kbd, Page, Progress, TextArea, toast } from "@/ui";
import { useT } from "@/i18n";
import { navigate } from "@/app/router";
import { backend } from "@/core/backend";
import {
  useDevices,
  layoutOf,
  listUnknownHidDevices,
  findRazerInterface,
  lightMatrixCell,
  lightLed,
  releaseLed,
  buildDefinitionFromMapping,
  TEMPLATES,
  getTemplate,
  type UnknownHidDevice,
} from "@/core/devices";
import { setFrameOverride } from "@/core/devices/manager";
import { simulators } from "@/core/devices/sim/razer";
import { useCommunity, deviceRequestUrl, communityErrorMessage, type PublishStep } from "@/core/community";
import { hsv } from "@/core/lighting";
import { useSettings } from "@/core/state/settings";
import type { ConnectedDevice, DeviceDefinition, RGB } from "@/core/types";
import { DeviceIcon } from "../dashboard/shared";

type Source = { kind: "unknown"; dev: UnknownHidDevice } | { kind: "connected"; device: ConnectedDevice };
type Probe =
  | { status: "idle" }
  | { status: "probing" }
  | { status: "ok"; firmware: string; serial?: string; transactionId?: number; path?: string; interfaceNumber?: number }
  | { status: "fail" };
type HistoryEntry = { cell: number; code: string | null; prevCell?: [number, number] };

const STEPS = ["device", "layout", "map", "review", "save"] as const;
const LIT: RGB = [255, 255, 255];
const MAPPED: RGB = [38, 110, 100];
const JUST: RGB = [80, 230, 190];

const parseHex = (v: string | undefined) => (v ? parseInt(v.replace(/^0x/i, ""), 16) : 0);
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export function Wizard({ preselect }: { preselect?: string }) {
  const t = useT();
  const devices = useDevices((s) => s.devices);
  const addDefinition = useDevices((s) => s.addDefinition);
  const author = useSettings((s) => s.settings.github.user);

  const [step, setStep] = useState(0);
  const [unknown, setUnknown] = useState<UnknownHidDevice[] | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [probe, setProbe] = useState<Probe>({ status: "idle" });
  const [templateId, setTemplateId] = useState("ansi-60");
  const [rows, setRows] = useState(6);
  const [cols, setCols] = useState(22);
  const [mapping, setMapping] = useState<Record<string, [number, number]>>({});
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [name, setName] = useState("");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  const remappable = devices.filter((d) => d.definition.driver === "razer" && d.definition.type === "keyboard");

  useEffect(() => {
    listUnknownHidDevices()
      .then(setUnknown)
      .catch(() => setUnknown([]));
  }, []);

  // ---------------------------------------------------------------- step 1: pick + probe
  const choose = useCallback(
    async (s: Source) => {
      setSource(s);
      setMapping({});
      setHistory([]);
      setCursor(0);
      setSaved(false);
      if (s.kind === "connected") {
        const def = s.device.definition;
        const m = (def.driverOptions?.matrix as { rows: number; cols: number } | undefined) ?? { rows: 6, cols: 22 };
        setRows(m.rows);
        setCols(m.cols);
        setName(`${def.name} (custom)`);
        setVendor(def.vendor);
        const keys = layoutOf(s.device)?.keys.length ?? 61;
        setTemplateId(keys > 90 ? "ansi-100" : keys > 75 ? "ansi-tkl" : keys > 66 ? "ansi-65" : "ansi-60");
        const tid = def.driverOptions?.transactionId;
        setProbe({ status: "ok", firmware: s.device.firmware ?? "?", serial: s.device.serial, transactionId: typeof tid === "string" ? parseHex(tid) : undefined });
        return;
      }
      setName(s.dev.product ?? "");
      setVendor(s.dev.manufacturer ?? (s.dev.vendorId === 0x1532 ? "Razer" : ""));
      setRows(6);
      setCols(22);
      setProbe({ status: "probing" });
      try {
        const r = await findRazerInterface(s.dev);
        setProbe(r ? { status: "ok", firmware: r.firmware, serial: r.serial, transactionId: r.transactionId, path: r.interface.path, interfaceNumber: r.interface.interfaceNumber } : { status: "fail" });
      } catch {
        setProbe({ status: "fail" });
      }
    },
    [],
  );

  useEffect(() => {
    if (!preselect || source || !unknown) return;
    const u = unknown.find((x) => x.id === decodeURIComponent(preselect));
    if (u) void choose({ kind: "unknown", dev: u });
  }, [preselect, unknown, source, choose]);

  // ---------------------------------------------------------------- LED control
  const total = rows * cols;
  const light = useCallback(
    async (row: number, col: number) => {
      if (!source) return;
      if (source.kind === "connected") lightLed(source.device.uid, [row, col], LIT);
      else if (probe.status === "ok" && probe.path) await lightMatrixCell(probe.path, row, col, LIT, { rows, cols }, probe.transactionId);
    },
    [source, probe, rows, cols],
  );
  const release = useCallback(() => {
    if (!source) return;
    if (source.kind === "connected") releaseLed(source.device.uid);
    else if (probe.status === "ok" && probe.path) void lightMatrixCell(probe.path, -1, -1, LIT, { rows, cols }, probe.transactionId).catch(() => {});
  }, [source, probe, rows, cols]);

  useEffect(() => {
    if (step !== 2 || cursor >= total) return;
    light(Math.floor(cursor / cols), cursor % cols).catch((e) => toast(String((e as Error)?.message ?? e), "danger"));
  }, [step, cursor, total, cols, light]);
  useEffect(() => (step === 2 ? release : undefined), [step, release]);

  // ---------------------------------------------------------------- mapping actions
  const template = getTemplate(templateId);
  const templateCodes = useMemo(() => new Set(template.layout.keys.map((k) => k.code)), [template]);

  const advance = (n: number) => {
    if (n >= total) {
      setCursor(total);
      setStep(3);
    } else setCursor(n);
  };
  const assign = (code: string) => {
    if (cursor >= total) return;
    if (!templateCodes.has(code)) {
      toast(t("devices.wiz.notOnTemplate", { key: code }));
      return;
    }
    const cell: [number, number] = [Math.floor(cursor / cols), cursor % cols];
    const prevCell = mapping[code];
    setMapping({ ...mapping, [code]: cell });
    setHistory([...history, { cell: cursor, code, prevCell }]);
    advance(cursor + 1);
  };
  const skip = () => {
    if (cursor >= total) return;
    setHistory([...history, { cell: cursor, code: null }]);
    advance(cursor + 1);
  };
  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    const next = { ...mapping };
    if (last.code) {
      if (last.prevCell) next[last.code] = last.prevCell;
      else delete next[last.code];
    }
    setMapping(next);
    setHistory(history.slice(0, -1));
    setCursor(last.cell);
    if (step !== 2) setStep(2);
  };

  // Physical keys: pressing the lit key maps it (on release, so Ctrl+Z / Ctrl+Space stay shortcuts).
  const keyState = useRef({ pressed: new Set<string>(), first: "", shortcut: false });
  const actions = useRef({ assign, skip, undo });
  actions.current = { assign, skip, undo };
  useEffect(() => {
    if (step !== 2) return;
    const ks = keyState.current;
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      e.preventDefault();
      if (e.repeat) return;
      if (ks.pressed.size === 0) {
        ks.first = e.code;
        ks.shortcut = false;
      }
      ks.pressed.add(e.code);
      if (e.ctrlKey && e.code === "KeyZ") {
        ks.shortcut = true;
        actions.current.undo();
      } else if (e.ctrlKey && (e.code === "Space" || e.code === "ArrowRight")) {
        ks.shortcut = true;
        actions.current.skip();
      }
    };
    const up = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      e.preventDefault();
      ks.pressed.delete(e.code);
      if (ks.pressed.size === 0) {
        if (!ks.shortcut && ks.first) actions.current.assign(ks.first);
        ks.first = "";
        ks.shortcut = false;
      }
    };
    const blur = () => ks.pressed.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [step]);

  // ---------------------------------------------------------------- definition
  const definition: DeviceDefinition | null = useMemo(() => {
    if (!source) return null;
    const match = source.kind === "connected" ? source.device.definition.match[0] : undefined;
    const base = name.toLowerCase().startsWith(vendor.toLowerCase()) && vendor ? name : `${vendor || "custom"}-${name || "keyboard"}`;
    const id = slug(base) + (source.kind === "connected" && !/custom/.test(name.toLowerCase()) ? "-custom" : "");
    return buildDefinitionFromMapping({
      id,
      name: name.trim() || "Custom keyboard",
      vendor: vendor.trim() || "Unknown",
      type: "keyboard",
      vendorId: source.kind === "connected" ? parseHex(match?.vendorId) : source.dev.vendorId,
      productId: source.kind === "connected" ? parseHex(match?.productId) : source.dev.productId,
      interface: source.kind === "connected" ? match?.interface : probe.status === "ok" ? probe.interfaceNumber : undefined,
      transactionId: probe.status === "ok" ? probe.transactionId : undefined,
      matrix: { rows, cols },
      templateId,
      mapping,
      author,
      notes: notes.trim() || undefined,
    });
  }, [source, name, vendor, probe, rows, cols, templateId, mapping, author, notes]);

  const mappedCount = Object.keys(mapping).length;
  const canNext = step === 0 ? probe.status === "ok" : step === 1 ? rows > 0 && cols > 0 && rows * cols <= 512 : step === 2 ? mappedCount > 0 : step === 3 ? mappedCount > 0 && !!name.trim() : false;

  return (
    <Page
      title={t("devices.wiz.title")}
      description={t("devices.wiz.subtitle")}
      actions={
        <Button variant="ghost" icon={<ArrowLeft />} onClick={() => navigate("devices")}>
          {t("devices.wiz.backToDevices")}
        </Button>
      }
    >
      <ol className="wiz-steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? "is-current" : i < step ? "is-done" : undefined}>
            <button type="button" disabled={i > step} onClick={() => i < step && setStep(i)}>
              <span className="wiz-steps__n">{i < step ? <Check /> : i + 1}</span>
              <span className="wiz-steps__label">{t(`devices.wiz.steps.${s}`)}</span>
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <StepDevice
          unknown={unknown}
          remappable={remappable}
          source={source}
          probe={probe}
          onChoose={(s) => void choose(s)}
        />
      )}
      {step === 1 && <StepLayout templateId={templateId} setTemplateId={setTemplateId} rows={rows} cols={cols} setRows={setRows} setCols={setCols} />}
      {step === 2 && source && (
        <StepMap
          source={source}
          templateId={templateId}
          mapping={mapping}
          setMapping={setMapping}
          cursor={cursor}
          rows={rows}
          cols={cols}
          lastCode={history[history.length - 1]?.code ?? null}
          canUndo={history.length > 0}
          onAssign={assign}
          onSkip={skip}
          onUndo={undo}
          onFinish={() => setStep(3)}
        />
      )}
      {step === 3 && definition && source && (
        <StepReview definition={definition} source={source} probe={probe} name={name} vendor={vendor} notes={notes} setName={setName} setVendor={setVendor} setNotes={setNotes} templateId={templateId} mapping={mapping} rows={rows} cols={cols} />
      )}
      {step === 4 && definition && (
        <StepSave
          definition={definition}
          saved={saved}
          testedOn={probe.status === "ok" ? `${definition.name} (fw ${probe.firmware})` : definition.name}
          onSave={() => {
            addDefinition(definition);
            setSaved(true);
            toast(t("devices.wiz.savedToast", { name: definition.name }));
          }}
        />
      )}

      <div className="wiz-nav">
        <Button icon={<ArrowLeft />} disabled={step === 0} onClick={() => setStep(step - 1)}>
          {t("common.back")}
        </Button>
        <span className="grow" />
        {step < 4 && (
          <Button variant="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
            {step === 2 && cursor < total ? t("devices.wiz.finishEarly") : t("common.next")}
            <ArrowRight />
          </Button>
        )}
      </div>
    </Page>
  );
}

// ===========================================================================
// Step 1 — device
// ===========================================================================

function StepDevice({
  unknown,
  remappable,
  source,
  probe,
  onChoose,
}: {
  unknown: UnknownHidDevice[] | null;
  remappable: ConnectedDevice[];
  source: Source | null;
  probe: Probe;
  onChoose: (s: Source) => void;
}) {
  const t = useT();
  const selectedId = source ? (source.kind === "unknown" ? source.dev.id : source.device.uid) : null;
  return (
    <div className="wiz-two">
      <Card title={t("devices.wiz.pickTitle")} subtitle={t("devices.wiz.pickHint")} flush>
        <div className="wiz-pick">
          <div className="wiz-pick__group">{t("devices.wizard.unknownDevices")}</div>
          {unknown === null && <div className="wiz-pick__empty subtle">{t("common.loading")}</div>}
          {unknown?.length === 0 && <div className="wiz-pick__empty subtle">{t("devices.page.unknownNone")}</div>}
          {unknown?.map((u) => (
            <button key={u.id} type="button" className="wiz-pick__row" aria-pressed={selectedId === u.id} onClick={() => onChoose({ kind: "unknown", dev: u })}>
              <span className="wiz-pick__icon">
                <Usb />
              </span>
              <span className="grow">
                <span className="wiz-pick__name">{u.product ?? t("devices.page.unnamed")}</span>
                <span className="wiz-pick__meta mono">
                  {u.id} · {u.manufacturer ?? "?"}
                </span>
              </span>
              {selectedId === u.id && <Check className="wiz-pick__check" />}
            </button>
          ))}
          {remappable.length > 0 && (
            <>
              <div className="wiz-pick__group">{t("devices.wiz.remapGroup")}</div>
              {remappable.map((d) => (
                <button key={d.uid} type="button" className="wiz-pick__row" aria-pressed={selectedId === d.uid} onClick={() => onChoose({ kind: "connected", device: d })}>
                  <span className="wiz-pick__icon">
                    <DeviceIcon type={d.definition.type} />
                  </span>
                  <span className="grow">
                    <span className="wiz-pick__name">{d.definition.name}</span>
                    <span className="wiz-pick__meta">
                      {t("devices.wiz.remapMeta", { fw: d.firmware ?? "?" })}
                    </span>
                  </span>
                  {selectedId === d.uid && <Check className="wiz-pick__check" />}
                </button>
              ))}
            </>
          )}
        </div>
      </Card>

      <Card title={t("devices.wiz.probeTitle")}>
        {!source && (
          <div className="wiz-probe wiz-probe--idle">
            <Wand2 />
            <div>{t("devices.wiz.probeIdle")}</div>
          </div>
        )}
        {source && probe.status === "probing" && (
          <div className="wiz-probe">
            <Loader2 className="dev-spin" />
            <div>{t("devices.wizard.probing")}</div>
          </div>
        )}
        {source && probe.status === "ok" && (
          <div className="wiz-probe wiz-probe--ok">
            <CircleCheck />
            <div className="grow">
              <div className="wiz-probe__title">{t("devices.wizard.razerFound", { firmware: probe.firmware })}</div>
              <dl className="dev-facts dev-facts--compact">
                <div>
                  <dt>{t("devices.page.firmware")}</dt>
                  <dd className="mono">{probe.firmware}</dd>
                </div>
                <div>
                  <dt>{t("devices.page.serial")}</dt>
                  <dd className="mono">{probe.serial ? `••••${probe.serial.slice(-4)}` : "—"}</dd>
                </div>
                <div>
                  <dt>{t("devices.wiz.transaction")}</dt>
                  <dd className="mono">{probe.transactionId !== undefined ? `0x${probe.transactionId.toString(16).toUpperCase().padStart(2, "0")}` : "—"}</dd>
                </div>
              </dl>
              <p className="wiz-note">{source.kind === "connected" ? t("devices.wiz.remapNote") : t("devices.wiz.readOnlyNote")}</p>
            </div>
          </div>
        )}
        {source && probe.status === "fail" && source.kind === "unknown" && (
          <div className="wiz-probe wiz-probe--fail">
            <CircleAlert />
            <div className="grow">
              <div className="wiz-probe__title">{t("devices.wizard.razerNotFound")}</div>
              <ul className="wiz-options">
                <li>
                  <b>{t("devices.drivers.lamparray")}.</b> {t("devices.wiz.optLampArray")}
                </li>
                <li>
                  <b>OpenRGB.</b> {t("devices.wiz.optOpenRgb")}
                </li>
                <li>
                  <b>{t("devices.page.requestSupport")}.</b> {t("devices.wiz.optRequest")}
                </li>
              </ul>
              <Button size="sm" icon={<LifeBuoy />} onClick={() => void backend.openPath(deviceRequestUrl(source.dev.interfaces))}>
                {t("devices.page.requestSupport")}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ===========================================================================
// Step 2 — layout template + matrix
// ===========================================================================

function StepLayout({
  templateId,
  setTemplateId,
  rows,
  cols,
  setRows,
  setCols,
}: {
  templateId: string;
  setTemplateId: (id: string) => void;
  rows: number;
  cols: number;
  setRows: (n: number) => void;
  setCols: (n: number) => void;
}) {
  const t = useT();
  const tpl = getTemplate(templateId);
  return (
    <Card title={t("devices.wiz.layoutTitle")} subtitle={t("devices.wiz.layoutHint")}>
      <div className="wiz-tpls">
        {Object.entries(TEMPLATES).map(([id, tp]) => (
          <button key={id} type="button" className="wiz-tpl" aria-pressed={id === templateId} onClick={() => setTemplateId(id)}>
            <span className="wiz-tpl__name">{t(`devices.layouts.${id}`)}</span>
            <span className="wiz-tpl__meta">{t("dashboard.keys", { n: tp.layout.keys.length })}</span>
          </button>
        ))}
      </div>
      <div className="wiz-preview">
        <KeyboardView keys={tpl.layout.keys} size={tpl.size} maxWidth={860} />
      </div>
      <div className="wiz-matrix">
        <Field label={t("devices.wiz.rows")} hint={t("devices.wiz.matrixHint")}>
          <Input type="number" min={1} max={16} value={rows} onChange={(e) => setRows(Math.max(1, Math.min(16, Number(e.target.value) || 1)))} />
        </Field>
        <Field label={t("devices.wiz.cols")}>
          <Input type="number" min={1} max={32} value={cols} onChange={(e) => setCols(Math.max(1, Math.min(32, Number(e.target.value) || 1)))} />
        </Field>
        <div className="wiz-matrix__sum">
          <span className="mono">{rows * cols}</span>
          <span className="subtle">{t("devices.wiz.cellsToVisit")}</span>
        </div>
      </div>
    </Card>
  );
}

// ===========================================================================
// Step 3 — LED mapping
// ===========================================================================

function StepMap({
  source,
  templateId,
  mapping,
  setMapping,
  cursor,
  rows,
  cols,
  lastCode,
  canUndo,
  onAssign,
  onSkip,
  onUndo,
  onFinish,
}: {
  source: Source;
  templateId: string;
  mapping: Record<string, [number, number]>;
  setMapping: (m: Record<string, [number, number]>) => void;
  cursor: number;
  rows: number;
  cols: number;
  lastCode: string | null;
  canUndo: boolean;
  onAssign: (code: string) => void;
  onSkip: () => void;
  onUndo: () => void;
  onFinish: () => void;
}) {
  const t = useT();
  const tpl = getTemplate(templateId);
  const total = rows * cols;
  const row = Math.floor(cursor / cols);
  const col = cursor % cols;
  const mapped = Object.keys(mapping).length;

  const colors = useMemo(() => {
    const c: Record<string, RGB> = {};
    for (const code of Object.keys(mapping)) c[code] = code === lastCode ? JUST : MAPPED;
    return c;
  }, [mapping, lastCode]);
  const badges = useMemo(() => Object.fromEntries(Object.entries(mapping).map(([code, [r, cc]]) => [code, `${r}·${cc}`])), [mapping]);

  // Browser demo: show what the simulated keyboard is lighting, and offer an auto-map.
  const demoDevice = backend.kind === "mock" && source.kind === "connected" && source.device.definition.id === "razer-huntsman-mini" ? source.device : undefined;

  return (
    <div className="wiz-map">
      <Card className="wiz-map__main">
        <div className="wiz-map__status">
          <div className="wiz-map__cell">
            <span className="wiz-map__pulse" />
            <span>
              {t("devices.wiz.cell")} <b className="mono">{row}</b>·<b className="mono">{col}</b>
            </span>
          </div>
          <div className="grow">
            <Progress value={cursor / total} />
          </div>
          <span className="wiz-map__count mono">
            {Math.min(cursor, total)}/{total}
          </span>
          <Badge tone="success">{t("devices.wiz.mapped", { n: mapped })}</Badge>
        </div>
        <p className="wiz-map__prompt">{t("devices.wiz.mapPrompt")}</p>
        <KeyboardView keys={tpl.layout.keys} size={tpl.size} colors={colors} badges={badges} onKeyClick={(code) => onAssign(code)} maxWidth={980} glow={0.6} />
        <div className="wiz-map__actions">
          <Button icon={<SkipForward />} onClick={onSkip}>
            {t("devices.wizard.skipLed")}
            <Kbd>Ctrl</Kbd>
            <Kbd>Space</Kbd>
          </Button>
          <Button variant="ghost" icon={<Undo2 />} disabled={!canUndo} onClick={onUndo}>
            {t("devices.wiz.undo")}
            <Kbd>Ctrl</Kbd>
            <Kbd>Z</Kbd>
          </Button>
          <span className="grow" />
          <span className="wiz-map__tip">{t("devices.wiz.physicalTip")}</span>
        </div>
      </Card>
      {demoDevice && (
        <DemoSimPanel
          device={demoDevice}
          col={col}
          onAutoMap={() => {
            const real = layoutOf(demoDevice);
            const tplCodes = new Set(tpl.layout.keys.map((k) => k.code));
            const m: Record<string, [number, number]> = {};
            for (const k of real?.keys ?? []) if (Array.isArray(k.led) && tplCodes.has(k.code)) m[k.code] = k.led;
            setMapping(m);
            onFinish();
          }}
        />
      )}
    </div>
  );
}

function DemoSimPanel({ device, col, onAutoMap }: { device: ConnectedDevice; col: number; onAutoMap: () => void }) {
  const t = useT();
  const layout = layoutOf(device);
  const [lit, setLit] = useState<Record<string, RGB>>({});
  useEffect(() => {
    const byLed = new Map<string, string>();
    for (const k of layout?.keys ?? []) if (Array.isArray(k.led)) byLed.set(`${k.led[0]},${k.led[1]}`, k.code);
    const id = setInterval(() => {
      const m = simulators.huntsman?.state.matrix;
      if (!m) return;
      const out: Record<string, RGB> = {};
      m.forEach((r, ri) => r.forEach((c, ci) => c[0] + c[1] + c[2] > 60 && byLed.has(`${ri},${ci}`) && (out[byLed.get(`${ri},${ci}`)!] = c)));
      setLit((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
    }, 120);
    return () => clearInterval(id);
  }, [layout]);
  if (!layout) return null;
  return (
    <Card
      className="wiz-sim"
      title={
        <span className="row">
          <FlaskConical width={14} height={14} /> {t("devices.wiz.simTitle")}
        </span>
      }
      subtitle={t("devices.wiz.simHint")}
      actions={
        <Button size="sm" icon={<Wand2 />} onClick={onAutoMap}>
          {t("devices.wiz.autoMap")}
        </Button>
      }
    >
      <KeyboardView keys={layout.keys} size={device.definition.size} colors={lit} maxWidth={640} />
      {Object.keys(lit).length === 0 && <div className="wiz-sim__none subtle">{t(col === 0 ? "devices.wiz.simNone" : "devices.wiz.simNothing")}</div>}
    </Card>
  );
}

// ===========================================================================
// Step 4 — review + live test
// ===========================================================================

function StepReview({
  definition,
  source,
  probe,
  name,
  vendor,
  notes,
  setName,
  setVendor,
  setNotes,
  templateId,
  mapping,
  rows,
  cols,
}: {
  definition: DeviceDefinition;
  source: Source;
  probe: Probe;
  name: string;
  vendor: string;
  notes: string;
  setName: (s: string) => void;
  setVendor: (s: string) => void;
  setNotes: (s: string) => void;
  templateId: string;
  mapping: Record<string, [number, number]>;
  rows: number;
  cols: number;
}) {
  const t = useT();
  const layout = Object.values(definition.layouts ?? {})[0];
  const tpl = getTemplate(templateId);
  const missing = tpl.layout.keys.filter((k) => !mapping[k.code]);
  const [testing, setTesting] = useState(false);
  const [phase, setPhase] = useState(0);
  const ordered = useMemo(() => [...(layout?.keys ?? [])].sort((a, b) => a.x - b.x || a.y - b.y), [layout]);

  // Rainbow sweep: whole frame on connected devices, a moving LED on undefined ones.
  useEffect(() => {
    if (!testing) return;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setPhase(i);
      const p = i * 0.04;
      if (source.kind === "connected") {
        const frame = ordered.map((k) => ({ led: k.led as [number, number], color: hsv((k.x / definition.size.w - p) * 360) }));
        setFrameOverride(source.device.uid, frame);
      } else if (probe.status === "ok" && probe.path) {
        const k = ordered[i % ordered.length];
        if (k?.led && Array.isArray(k.led)) void lightMatrixCell(probe.path, k.led[0], k.led[1], hsv(i * 6), { rows, cols }, probe.transactionId).catch(() => {});
      }
    }, source.kind === "connected" ? 50 : 110);
    return () => {
      clearInterval(id);
      if (source.kind === "connected") setFrameOverride(source.device.uid, null);
      else if (probe.status === "ok" && probe.path) void lightMatrixCell(probe.path, -1, -1, [0, 0, 0], { rows, cols }, probe.transactionId).catch(() => {});
    };
  }, [testing, ordered, source, probe, rows, cols, definition.size.w]);

  const preview = useMemo(() => {
    if (!testing) return {};
    const p = phase * 0.04;
    const out: Record<string, RGB> = {};
    if (source.kind === "connected") for (const k of ordered) out[k.code] = hsv((k.x / definition.size.w - p) * 360);
    else {
      const k = ordered[phase % Math.max(1, ordered.length)];
      if (k) out[k.code] = hsv(phase * 6);
    }
    return out;
  }, [testing, phase, ordered, source.kind, definition.size.w]);

  return (
    <div className="wiz-review">
      <Card
        title={t("devices.wiz.reviewTitle")}
        subtitle={t("devices.wiz.reviewHint", { mapped: Object.keys(mapping).length, total: tpl.layout.keys.length })}
        actions={
          <Button size="sm" variant={testing ? "secondary" : "primary"} icon={testing ? <Square /> : <Play />} onClick={() => setTesting(!testing)}>
            {testing ? t("devices.wiz.stopTest") : t("devices.wiz.liveTest")}
          </Button>
        }
      >
        {layout && <KeyboardView keys={layout.keys} size={definition.size} colors={preview} maxWidth={900} />}
        {missing.length > 0 && (
          <div className="wiz-missing">
            <span className="subtle">{t("devices.wiz.unmapped", { n: missing.length })}</span>
            {missing.slice(0, 24).map((k) => (
              <Kbd key={k.code}>{k.label || k.code}</Kbd>
            ))}
            {missing.length > 24 && <span className="subtle">+{missing.length - 24}</span>}
          </div>
        )}
      </Card>
      <Card title={t("devices.wiz.detailsTitle")}>
        <div className="wiz-fields">
          <Field label={t("common.name")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Huntsman Mini" />
          </Field>
          <Field label={t("devices.wiz.vendor")}>
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Razer" />
          </Field>
          <Field label={t("devices.wiz.notes")} hint={t("devices.wiz.notesHint")}>
            <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </Field>
          <dl className="dev-facts dev-facts--compact">
            <div className="wiz-fullrow">
              <dt>ID</dt>
              <dd className="mono">{definition.id}</dd>
            </div>
            <div>
              <dt>USB</dt>
              <dd className="mono">
                {definition.match[0].vendorId}:{definition.match[0].productId}
              </dd>
            </div>
            <div>
              <dt>{t("devices.wiz.matrix")}</dt>
              <dd className="mono">
                {rows}×{cols}
              </dd>
            </div>
            <div>
              <dt>{t("devices.wiz.status")}</dt>
              <dd>
                <Badge tone="warning">{t("devices.status.experimental")}</Badge>
              </dd>
            </div>
          </dl>
        </div>
      </Card>
    </div>
  );
}

// ===========================================================================
// Step 5 — save + publish
// ===========================================================================

function StepSave({ definition, saved, testedOn, onSave }: { definition: DeviceDefinition; saved: boolean; testedOn: string; onSave: () => void }) {
  const t = useT();
  const auth = useCommunity((s) => s.auth);
  const publish = useCommunity((s) => s.publish);
  const [progress, setProgress] = useState<PublishStep | null>(null);
  const [pr, setPr] = useState<string | null>(null);
  const json = useMemo(() => JSON.stringify(definition, null, 2), [definition]);

  const download = () => {
    const url = URL.createObjectURL(new Blob([json + "\n"], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${definition.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const doPublish = async () => {
    try {
      setProgress("fork");
      const r = await publish({ kind: "device", data: definition, testedOn: [testedOn], notes: definition.notes, onProgress: setProgress });
      setPr(r.prUrl);
      toast(t("devices.wiz.published"));
    } catch (e) {
      toast(communityErrorMessage(e), "danger");
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="wiz-two">
      <Card title={t("devices.wiz.saveTitle")} subtitle={t("devices.wiz.saveHint")}>
        <div className="wiz-save">
          <div className={`wiz-save__state${saved ? " is-done" : ""}`}>
            {saved ? <CircleCheck /> : <Keyboard />}
            <div>
              <div className="wiz-probe__title">{saved ? t("devices.wizard.done") : definition.name}</div>
              <div className="subtle">{saved ? t("devices.wiz.savedText") : t("devices.wiz.saveText")}</div>
            </div>
          </div>
          <div className="row wrap">
            <Button variant="primary" icon={<Save />} disabled={saved} onClick={onSave}>
              {saved ? t("devices.wiz.saved") : t("devices.wiz.saveLocal")}
            </Button>
            <Button icon={<Download />} onClick={download}>
              {t("devices.wiz.downloadJson")}
            </Button>
            <Button
              variant="ghost"
              icon={<Copy />}
              onClick={() =>
                void navigator.clipboard
                  .writeText(json)
                  .then(() => toast(t("common.copied")))
                  .catch(() => {})
              }
            >
              {t("common.copy")}
            </Button>
          </div>
          {saved && (
            <Button variant="ghost" icon={<ArrowRight />} onClick={() => navigate("devices")}>
              {t("devices.wiz.backToDevices")}
            </Button>
          )}
        </div>
      </Card>
      <Card title={t("devices.wiz.publishTitle")} subtitle={t("devices.wiz.publishHint")}>
        <div className="wiz-save">
          {pr ? (
            <div className="wiz-save__state is-done">
              <CircleCheck />
              <div>
                <div className="wiz-probe__title">{t("devices.wiz.published")}</div>
                <a href={pr} target="_blank" rel="noreferrer" className="mono">
                  {pr}
                </a>
              </div>
            </div>
          ) : auth.status === "signedIn" ? (
            <>
              <div className="subtle">{t("devices.wiz.signedInAs", { login: auth.login })}</div>
              <Button variant="primary" icon={progress ? <Loader2 className="dev-spin" /> : <Share2 />} disabled={!!progress} onClick={() => void doPublish()}>
                {progress ? t(`community.share.steps.${progress}`) : t("devices.wiz.publish")}
              </Button>
            </>
          ) : (
            <>
              <div className="subtle">{t("devices.wiz.signInFirst")}</div>
              <Button icon={<Share2 />} onClick={() => navigate("community/share")}>
                {t("devices.wiz.openShare")}
              </Button>
            </>
          )}
          <details className="wiz-json">
            <summary>{t("devices.wiz.viewJson", { file: `community/devices/${slug(definition.vendor)}/${definition.id}.json` })}</summary>
            <pre className="mono">{json}</pre>
          </details>
        </div>
      </Card>
    </div>
  );
}
