import { useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { Button, Input } from "@/ui";
import { useT } from "@/i18n";
import { addTask, GRID, parseButton, setTasks, TASK_CLEAR, TASK_NEW, type PadPage } from "@/core/pads";
import { Head } from "./Inspector";

/** Inspector for a Tasks page: edit the selected pad's task, or write one on an empty pad. */
export function TasksEditor({ page, selected }: { page: PadPage; selected: string }) {
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
