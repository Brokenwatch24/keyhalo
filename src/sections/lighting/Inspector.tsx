import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, AppWindow, Copy, ExternalLink, Lock, Plus, Repeat2, SlidersHorizontal, Trash2, X } from "lucide-react";
import { Badge, Button, ColorInput, EmptyState, Field, Input, Segmented, Select, Slider, Tabs, TextArea, Toggle, toast } from "@/ui";
import { backend } from "@/core/backend";
import { effectRegistry, resolveParams, useEffects, useLighting, useProfiles } from "@/core/lighting";
import { useDevices } from "@/core/devices";
import { navigate } from "@/app/router";
import type { BlendMode, EffectMeta, EffectParamDef, LightingLayer } from "@/core/types";
import { deleteLayer, duplicateLayer } from "./LayersPanel";
import { categoryOf, layerSwatch, plural, useDesk, useFx, useStudio, WIDGET_SOURCES } from "./util";

type Tab = "layer" | "profile";
const BLENDS: BlendMode[] = ["normal", "add", "screen", "multiply", "max"];

export function Inspector() {
  const fx = useFx();
  const t = fx.t;
  const [tab, setTab] = useState<Tab>("layer");
  const selected = useStudio((s) => s.selectedLayer);
  const layer = useLighting((s) => s.scene.layers.find((l) => l.id === selected));

  useEffect(() => {
    if (selected) setTab("layer");
  }, [selected]);

  return (
    <section className="kh-card lighting-panel lighting-inspector">
      <header className="lighting-panel__head lighting-panel__head--tabs">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "layer", label: t("lighting.inspector.layerTab"), icon: <SlidersHorizontal /> },
            { value: "profile", label: t("lighting.inspector.profileTab"), icon: <AppWindow /> },
          ]}
        />
      </header>
      <div className="lighting-panel__body">
        {tab === "profile" ? (
          <ProfileInspector />
        ) : layer ? (
          <LayerInspector key={layer.id} layer={layer} />
        ) : (
          <EmptyState icon={<SlidersHorizontal />} title={t("lighting.inspector.noLayer")}>
            {t("lighting.inspector.noLayerHint")}
          </EmptyState>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

function Section({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="lighting-section">
      <div className="lighting-section__head">
        <span>{title}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

function LayerInspector({ layer }: { layer: LightingLayer }) {
  const fx = useFx();
  const t = fx.t;
  useEffects();
  const meta = effectRegistry.get(layer.effect)?.meta;
  const error = useLighting((s) => s.errors[layer.id]);
  const keys = useStudio((s) => s.keys);
  const setKeys = useStudio((s) => s.setKeys);
  const openPicker = useStudio((s) => s.openPicker);
  const desk = useDesk();
  const update = (patch: Partial<LightingLayer>) => useLighting.getState().updateLayer(layer.id, patch);
  const values = meta ? resolveParams(meta, layer.params) : layer.params;
  const setParam = (k: string, v: unknown) => update({ params: { ...layer.params, [k]: v } });
  const cat = categoryOf(meta);
  const widget = WIDGET_SOURCES[layer.effect];

  // Device filter: definition ids of the desk devices of one type.
  const kinds = useMemo(() => {
    const ids = (type: string) => [...new Set(desk.filter((d) => d.type === type).map((d) => d.definition.id))];
    return { keyboard: ids("keyboard"), mouse: ids("mouse") };
  }, [desk]);
  const devFilter = !layer.devices?.length
    ? "all"
    : layer.devices.every((d) => kinds.keyboard.includes(d) || desk.some((x) => x.uid === d && x.type === "keyboard"))
      ? "keyboard"
      : layer.devices.every((d) => kinds.mouse.includes(d) || desk.some((x) => x.uid === d && x.type === "mouse"))
        ? "mouse"
        : "custom";

  const params = Object.entries(meta?.params ?? {});

  return (
    <div className="lighting-inspect">
      <div className="lighting-inspect__head">
        <span className={`lighting-swatch lighting-swatch--lg lighting-swatch--${cat}`} style={{ background: layerSwatch(layer, meta) }} />
        <div className="grow">
          <div className="lighting-inspect__title">
            {fx.name(meta, layer.effect)}
            <Badge>{t(`lighting.categories.${cat}`)}</Badge>
            {meta?.author && meta.source === "community" && <span className="subtle lighting-inspect__author">{t("lighting.picker.by", { author: meta.author })}</span>}
          </div>
          {meta && <div className="lighting-inspect__desc">{fx.desc(meta)}</div>}
        </div>
        <div className="row lighting-inspect__actions">
          <Button size="sm" variant="ghost" icon={<Repeat2 />} onClick={() => openPicker({ mode: "replace", layerId: layer.id })}>
            {t("lighting.inspector.change")}
          </Button>
          <Button size="sm" variant="ghost" iconOnly icon={<Copy />} title={t("lighting.layers.duplicate")} onClick={() => duplicateLayer(layer.id)} />
          <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} title={t("lighting.layers.delete")} onClick={() => deleteLayer(layer.id)} />
        </div>
      </div>

      {error && (
        <div className="lighting-callout lighting-callout--danger">
          <AlertTriangle />
          <span className="grow">{t("lighting.errors.layerDisabled", { reason: error })}</span>
          <Button size="sm" onClick={() => retryLayer(layer)}>
            {t("lighting.inspector.retry")}
          </Button>
        </div>
      )}

      <div className="lighting-inspect__grid">
        <Section title={t("lighting.inspector.effect")}>
          {!meta && <div className="subtle">{t("lighting.errors.unknownEffect", { id: layer.effect })}</div>}
          {meta && params.length === 0 && <div className="subtle lighting-muted-sm">{t("lighting.inspector.noParams")}</div>}
          <div className="lighting-params">
            {params.map(([k, def]) => (
              <ParamControl key={k} id={k} def={def} value={values[k]} onChange={(v) => setParam(k, v)} meta={meta!} />
            ))}
          </div>
          {widget && (
            <div className="lighting-callout">
              <ExternalLink />
              <span className="grow">
                {t("lighting.widget.reads", { signal: t(`lighting.widget.signals.${widget.signal}`) })}{" "}
                {widget.where !== "none" && <span className="subtle">{t(`lighting.widget.where.${widget.where}`)}</span>}
              </span>
              {widget.where !== "none" && (
                <Button size="sm" variant="ghost" onClick={() => navigate(widget.where)}>
                  {t("lighting.widget.open")}
                </Button>
              )}
            </div>
          )}
          {meta?.reactive && <div className="lighting-note">{t("lighting.inspector.reactiveNote")}</div>}
        </Section>

        <Section title={t("lighting.inspector.layer")}>
          <div className="lighting-row2">
            <Field label={t("lighting.inspector.blend")}>
              <Select value={layer.blend} onChange={(v) => update({ blend: v })} options={BLENDS.map((b) => ({ value: b, label: t(`lighting.blend.${b}`) }))} />
            </Field>
            <Field label={t("lighting.inspector.visible")}>
              <div className="lighting-toggle-cell">
                <Toggle checked={layer.enabled} onChange={(v) => update({ enabled: v })} label={layer.enabled ? t("common.on") : t("common.off")} />
              </div>
            </Field>
          </div>
          <Slider label={t("lighting.inspector.opacity")} value={Math.round(layer.opacity * 100)} min={0} max={100} format={(v) => `${v}%`} onChange={(v) => update({ opacity: v / 100 })} />

          <div className="lighting-subhead">{t("lighting.inspector.appliesTo")}</div>
          <Segmented
            value={layer.mask?.length ? "keys" : "all"}
            onChange={(v) => {
              if (v === "all") update({ mask: undefined });
              else if (keys.size) update({ mask: [...keys] });
              else toast(t("lighting.inspector.selectFirst"));
            }}
            options={[
              { value: "all", label: t("lighting.inspector.wholeDesk") },
              { value: "keys", label: t("lighting.inspector.selectedKeys") },
            ]}
          />
          {layer.mask?.length ? (
            <div className="lighting-mask">
              <span className="grow">{plural(t, "lighting.layers.keys", layer.mask.length)}</span>
              <Button size="sm" variant="ghost" onClick={() => setKeys(layer.mask!)}>
                {t("lighting.inspector.showMask")}
              </Button>
              <Button size="sm" disabled={!keys.size} onClick={() => update({ mask: [...keys] })}>
                {t("lighting.inspector.useSelection", { n: keys.size })}
              </Button>
            </div>
          ) : (
            <div className="lighting-muted-sm subtle">{keys.size ? t("lighting.inspector.maskHintSel", { n: keys.size }) : t("lighting.inspector.maskHint")}</div>
          )}

          {kinds.keyboard.length > 0 && kinds.mouse.length > 0 && (
            <>
              <div className="lighting-subhead">{t("lighting.inspector.devices")}</div>
              <Segmented
                value={devFilter}
                onChange={(v) => update({ devices: v === "all" ? undefined : v === "keyboard" ? kinds.keyboard : v === "mouse" ? kinds.mouse : layer.devices })}
                options={[
                  { value: "all", label: t("lighting.inspector.allDevices") },
                  { value: "keyboard", label: t("lighting.inspector.keyboard") },
                  { value: "mouse", label: t("lighting.inspector.mouse") },
                  ...(devFilter === "custom" ? [{ value: "custom" as const, label: t("lighting.inspector.custom") }] : []),
                ]}
              />
            </>
          )}
        </Section>
      </div>
    </div>
  );
}

/** Re-create a layer the engine disabled (e.g. a community effect that timed out). */
function retryLayer(layer: LightingLayer) {
  const s = useLighting.getState();
  const all = s.scene.layers;
  s.setLayers(all.filter((l) => l.id !== layer.id));
  s.setLayers(all);
  useLighting.getState().updateLayer(layer.id, { params: { ...layer.params } });
}

const decimals = (step = 1) => (step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step) - 1e-9)));

function ParamControl({ id, def, value, onChange, meta }: { id: string; def: EffectParamDef; value: unknown; onChange: (v: unknown) => void; meta: EffectMeta }) {
  const fx = useFx();
  const devices = useDevices((s) => s.devices);
  const label = fx.label(def.label);
  switch (def.type) {
    case "number": {
      const v = typeof value === "number" ? value : def.default;
      const d = Math.max(decimals(def.step), Math.min(2, (String(v).split(".")[1] ?? "").length));
      return <Slider label={label} value={v} min={def.min} max={def.max} step={def.step ?? 1} format={(x) => x.toFixed(d)} onChange={onChange} />;
    }
    case "color":
      return (
        <div className="lighting-param-inline">
          <span className="lighting-param-label">{label}</span>
          <ColorInput value={typeof value === "string" ? value : def.default} onChange={onChange} />
        </div>
      );
    case "colors": {
      const list = Array.isArray(value) && value.length ? (value as string[]) : def.default;
      return (
        <div className="lighting-colors">
          <div className="lighting-param-label">{label}</div>
          <div className="lighting-colors__list">
            {list.map((c, i) => (
              <span key={i} className="lighting-colors__item">
                <ColorInput value={c} onChange={(nc) => onChange(list.map((x, j) => (j === i ? nc : x)))} />
                {list.length > 1 && (
                  <button type="button" className="lighting-iconbtn" title={fx.t("common.delete")} onClick={() => onChange(list.filter((_, j) => j !== i))}>
                    <X />
                  </button>
                )}
              </span>
            ))}
            {list.length < 8 && (
              <button type="button" className="lighting-addcolor" title={fx.t("lighting.inspector.addColor")} onClick={() => onChange([...list, list[list.length - 1] ?? "#ffffff"])}>
                <Plus />
              </button>
            )}
          </div>
        </div>
      );
    }
    case "boolean":
      return (
        <div className="lighting-param-inline">
          <span className="lighting-param-label">{label}</span>
          <Toggle checked={typeof value === "boolean" ? value : def.default} onChange={onChange} />
        </div>
      );
    case "select": {
      let options = def.options.map((o) => ({ value: o.value, label: fx.label(o.label) }));
      // The battery widget can target any connected wireless device.
      if (meta.id === "widget:battery" && id === "device")
        options = [...options, ...devices.filter((d) => d.definition.capabilities.battery).map((d) => ({ value: d.uid, label: d.definition.name }))];
      return (
        <Field label={label}>
          <Select value={typeof value === "string" ? value : def.default} onChange={onChange} options={options} />
        </Field>
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function ProfileInspector() {
  const t = useFx().t;
  const activeId = useProfiles((s) => s.activeId);
  const profile = useProfiles((s) => s.profiles.find((p) => p.id === s.activeId));
  const source = useProfiles((s) => (s.activeId ? s.sources[s.activeId] : undefined));
  const editable = source === "user";
  const [desc, setDesc] = useState(profile?.description ?? "");
  const [app, setApp] = useState("");
  const [running, setRunning] = useState<string[]>([]);
  useEffect(() => setDesc(profile?.description ?? ""), [profile?.id, profile?.description]);
  useEffect(() => {
    void backend
      .processes()
      .then((p) => setRunning(p))
      .catch(() => setRunning([]));
  }, []);
  if (!profile || !activeId) return <EmptyState title={t("lighting.profile.none")} />;
  const apps = profile.apps ?? [];
  const setApps = (next: string[]) => useProfiles.getState().update(profile.id, { apps: [...new Set(next)] });
  const addApp = (name: string) => {
    const v = name.trim();
    if (!v) return;
    setApps([...apps, v]);
    setApp("");
  };
  const suggestions = running.filter((p) => !apps.some((a) => a.toLowerCase() === p.toLowerCase())).slice(0, 8);
  const layers = profile.lighting.layers.length;

  return (
    <div className="lighting-inspect__grid">
      <Section title={t("lighting.profile.about")}>
        <div className="lighting-profilecard">
          <div className="lighting-inspect__title">
            {profile.name}
            <Badge>{t(`lighting.profile.source.${source ?? "user"}`)}</Badge>
          </div>
          <div className="subtle lighting-muted-sm">
            {[profile.author && t("lighting.picker.by", { author: profile.author }), plural(t, "lighting.profile.layers", layers)].filter(Boolean).join(" · ")}
          </div>
        </div>
        {editable ? (
          <Field label={t("common.description")}>
            <TextArea
              className="lighting-desc"
              value={desc}
              placeholder={t("lighting.profile.descPlaceholder")}
              onChange={(e) => setDesc(e.target.value)}
              onBlur={() => desc !== (profile.description ?? "") && useProfiles.getState().update(profile.id, { description: desc })}
            />
          </Field>
        ) : (
          <>
            {profile.description && <p className="lighting-inspect__desc">{profile.description}</p>}
            <div className="lighting-callout">
              <Lock />
              <span className="grow">{t("lighting.profiles.readOnly")}</span>
            </div>
          </>
        )}
      </Section>
      <Section title={t("lighting.profile.apps")}>
        <div className="lighting-muted-sm subtle">{t("lighting.profile.appsHint")}</div>
        <div className="lighting-appchips">
          {apps.length === 0 && <span className="subtle lighting-muted-sm">{t("lighting.profile.noApps")}</span>}
          {apps.map((a) => (
            <span key={a} className="lighting-appchip">
              {a}
              {editable && (
                <button type="button" title={t("common.delete")} onClick={() => setApps(apps.filter((x) => x !== a))}>
                  <X />
                </button>
              )}
            </span>
          ))}
        </div>
        {editable && (
          <>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                addApp(app);
              }}
            >
              <Input value={app} onChange={(e) => setApp(e.target.value)} placeholder="Game.exe" list="lighting-procs" />
              <datalist id="lighting-procs">
                {running.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
              <Button type="submit" icon={<Plus />} disabled={!app.trim()}>
                {t("common.add")}
              </Button>
            </form>
            {suggestions.length > 0 && (
              <div className="lighting-suggest">
                <span className="subtle lighting-muted-sm">{t("lighting.profile.running")}</span>
                {suggestions.map((p) => (
                  <button key={p} type="button" className="lighting-chip" onClick={() => addApp(p)}>
                    <Plus size={12} /> {p}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </Section>
    </div>
  );
}

