import { getSchedule } from "@/modules/availability/service";
import { ScheduleForm } from "@/modules/availability/components/schedule-form";
import { requireOrganizer } from "@/modules/organizers/server";
import { getDatabase } from "@/server/db/client";

export default async function SchedulePage() {
  const owner = await requireOrganizer();
  const schedule = await getSchedule(getDatabase(), owner.id);
  return <><p className="text-xs font-semibold tracking-widest text-accent uppercase">Ваш ритм</p><h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">Расписание</h1><p className="mt-4 max-w-2xl text-sm leading-7 text-muted">Общие часы для всех ваших страниц. В любой момент можно добавить перерыв, выходной или особую дату.</p>
    <ScheduleForm initial={schedule} timezones={["UTC", ...Intl.supportedValuesOf("timeZone")]} /></>;
}
