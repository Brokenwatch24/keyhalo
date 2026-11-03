import { useEffect, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { Badge, Button, Input, Segmented } from "@/ui";
import { useT } from "@/i18n";
import { addTask, GRID, parseButton, setTasks, TASK_CLEAR, TASK_NEW, usePads, type PadPage } from "@/core/pads";
import { hub, useHub } from "@/core/integrations/hub";
import { hubColor, isHubPage, newTasksTarget, refreshHubTasks, toggleHubTask, useHubTasks } from "@/core/pads/hubTasks";
import { pgo, usePlatiaGo } from "@/core/integrations/platiago";
import { Group, Head } from "./Inspector";

/** Inspector for a Tasks page: where its tasks come from, then the selected pad. */
export function TasksEditor({ page, selected }: { page: PadPage; selected: string }) {
  const t = useT();
  const installed = useHub((s) => s.installed);
  const platia = usePlatiaGo((s) => s.installed);
  const updatePage = usePads((s) => s.updatePage);
  const hubMode = isHubPage(page);
  return (
    <>
      {hubMode ? <HubTaskEditor selected={selected} /> : <LocalTaskEditor page={page} selected={selected} />}
      <div className="pads-insp__section">
        <Group label={t("pads.hub.source")} hint={t("pads.hub.sourceHint")}>
          <Segmented
            value={hubMode ? "hub" : "local"}
            onChange={(source) => updatePage(page.id, { source: source as "hub" | "local" })}
            options={[
              { value: "hub", label: t("pads.hub.sourceHub") },
              { value: "local", label: t("pads.hub.sourceLocal") },
            ]}
          />
        </Group>
        {hubMode && installed === false && !platia && <p className="pads-note">{t("pads.hub.notInstalled")}</p>}
        {hubMode && installed && platia && (
          <Group label={t("pads.hub.newTo")} hint={t("pads.hub.newToHint")}>
            <Segmented
              value={newTasksTarget(page)}
              onChange={(to) => updatePage(page.id, { newTasksTo: to as "hilo" | "platia" })}
              options={[
                { value: "hilo", label: "HILO" },
                { value: "platia", label: "Platia GO" },
              ]}
            />
          </Group>
        )}
      </div>
    </>
  );
}

/** HILO's to-dos (BrokenWatchHub): the selected one, or add one. */
function HubTaskEditor({ selected }: { selected: string }) {
  const t = useT();
  const b = parseButton(selected);
  const slot = b && b.kind === "g" ? b.y * GRID + b.x : -1;
  const { items, status, error, closing } = useHubTasks();
  const task = items.find((x) => x.slot === slot);
  const [text, setText] = useState("");
  useEffect(() => {
    void refreshHubTasks();
  }, []);
  const state =
    status === "error" ? <p className="pads-note">{t("pads.hub.error", { error: error ?? "" })}</p> : status === "ok" ? <p className="pads-note">{t("pads.hub.connected", { n: items.length })}</p> : null;
  if (task)
    return (
      <>
        <Head kicker={[task.kind, task.who].filter(Boolean).join(" · ")} title={task.title}>
          {task.due && (
            <Badge tone={task.overdue ? "danger" : "warning"} dot>
              {task.due}
            </Badge>
          )}
        </Head>
        <div className="pads-insp__section">
          {task.full !== task.title && <p className="pads-agent-msg">{task.full}</p>}
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <span className="pads-agent-dot" style={{ ["--c" as string]: hubColor(task) }} />
            <Button size="sm" variant={closing[task.id] ? "ghost" : "primary"} icon={<Check />} onClick={() => toggleHubTask(task)}>
              {closing[task.id] ? t("pads.hub.undone") : t("pads.hub.markDone")}
            </Button>
          </div>
          <p className="pads-note">{t("pads.hub.mapHint")}</p>
          {state}
        </div>
      </>
    );
  return (
    <>
      <Head kicker={t("pads.hub.sourceHub")} title={t("pads.hub.capture")} />
      <div className="pads-insp__section">
        <form
          className="row"
          style={{ gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            const v = text.trim();
            if (!v) return;
            void (newTasksTarget(usePads.getState().board.pages.find((p) => p.kind === "tasks")) === "platia" ? pgo.addTodo(v) : hub.capture(v))
              .then(() => {
                setText("");
                return refreshHubTasks();
              })
              .catch(() => {});
          }}
        >
          <Input className="grow" value={text} placeholder={t("pads.hub.placeholder")} onChange={(e) => setText(e.target.value)} />
          <Button size="sm" type="submit" disabled={!text.trim()}>
            {t("pads.tasks.addHere")}
          </Button>
        </form>
        <p className="pads-note">{t("pads.hub.mapHint")}</p>
        {state}
      </div>
    </>
  );
}

/** This page's own checklist: edit the selected pad's task, or write one on an empty pad. */
function LocalTaskEditor({ page, selected }: { page: PadPage; selected: string }) {
  const t = useT();
  const b = parseButton(selected);
  const slot = b && b.kind === "g" ? b.y * GRID + b.x : -1;
  const task = (page.tasks ?? []).find((x) => x.slot === slot);
  const [text, setText] = useState(task?.text ?? "");

  if (selected === TASK_NEW || selected === TASK_CLEAR) {
    const isNew = selected === TASK_NEW;
    return (
      <>
        <Head kicker={t("pads.page.kinds.tasks")} title={isNew ? t("pads.tasks.add") : t("pads.tasks.clearDone")} />
        <div className="pads-insp__section">
          <p className="pads-note">{isNew ? t("pads.tasks.emptyHint") : t("pads.tasks.mapHint")}</p>
          {!isNew && (
            <div>
              <Button size="sm" icon={<Trash2 />} onClick={() => setTasks(page.id, (ts) => ts.filter((x) => !x.done))}>
                {t("pads.tasks.clearDone")}
              </Button>
            </div>
          )}
        </div>
      </>
    );
  }
  if (slot < 0) return null;

  if (!task) {
    return (
      <>
        <Head kicker={t("pads.page.kinds.tasks")} title={t("pads.tasks.empty")} />
        <div className="pads-insp__section">
          <form
            className="row"
            style={{ gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              addTask(page.id, text, slot);
            }}
          >
            <Input className="grow" value={text} placeholder={t("pads.tasks.placeholder")} onChange={(e) => setText(e.target.value)} />
            <Button size="sm" type="submit" disabled={!text.trim()}>
              {t("pads.tasks.addHere")}
            </Button>
          </form>
          <p className="pads-note">{t("pads.tasks.emptyHint")}</p>
        </div>
      </>
    );
  }

  const update = (patch: { text?: string; done?: boolean }) => setTasks(page.id, (ts) => ts.map((x) => (x.id === task.id ? { ...x, ...patch } : x)));
  return (
    <>
      <Head kicker={task.done ? t("pads.tasks.done") : t("pads.tasks.pending")} title={task.text} />
      <div className="pads-insp__section">
        <Input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() && text.trim() !== task.text && update({ text: text.trim() })} />
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" variant={task.done ? "ghost" : "primary"} icon={<Check />} onClick={() => update({ done: !task.done })}>
            {task.done ? t("pads.tasks.pending") : t("pads.tasks.done")}
          </Button>
          <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => setTasks(page.id, (ts) => ts.filter((x) => x.id !== task.id))}>
            {t("pads.tasks.delete")}
          </Button>
        </div>
        <p className="pads-note">{t("pads.tasks.hint")}</p>
      </div>
    </>
  );
}
