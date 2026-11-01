import { BrandMark } from "@/components/ui/brand-mark";
import { landing } from "@/i18n/messages/ru/landing";
import { Icon } from "./icon";

const t = landing.dashboard;
export function DashboardPreview() {
  return <div className="landing-dashboard-wrap" role="img" aria-label={`${t.label}: три подтверждённые встречи и свободное время между ними.`}>
    <div className="landing-dashboard" aria-hidden="true">
      <div className="landing-dashboard-sidebar"><div className="landing-mini-brand"><BrandMark />Slotly</div><div>{t.sidebar.map((label, i) => <div key={label} className={i === 0 ? "landing-sidebar-active" : ""}><Icon name={i === 0 ? "check-calendar" : i === 1 ? "link" : "calendar"} />{label}</div>)}</div><span className="landing-mini-user">АК<span>Анна К.</span></span></div>
      <div className="landing-dashboard-content"><div className="landing-dashboard-heading"><div><p>{t.date}</p><h3>{t.heading}</h3></div><span className="landing-meeting-count">3</span></div>
        <div className="landing-dashboard-meetings">{t.meetings.map((meeting, i) => <div key={meeting.time}><div className="landing-dashboard-meeting"><span className="landing-dashboard-time">{meeting.time}</span><span className={`landing-mini-avatar ${meeting.tone}`}>{meeting.initials}</span><div><h4>{meeting.title}</h4><p>{meeting.guest}</p></div><Icon name="check" className="landing-meeting-check" /></div>{i === 0 && <div className="landing-dashboard-break"><span /><Icon name="coffee" />{t.gap}<span /></div>}</div>)}</div>
        <div className="landing-dashboard-bottom"><Icon name="shield" />{t.connection}</div>
      </div>
    </div><span className="landing-dashboard-caption">{t.label}</span>
  </div>;
}
