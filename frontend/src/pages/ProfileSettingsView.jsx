import { useSearchParams } from 'react-router-dom';
import ProfileHeader from '../components/settings/ProfileHeader';
import CustomerSettings from '../components/settings/CustomerSettings';
import AdminSectionTabs, { ADMIN_SECTIONS } from '../components/settings/AdminSectionTabs';
import GeneralTab from '../components/settings/GeneralTab';
import DataBackupsTab from '../components/settings/DataBackupsTab';
import NotificationsTab from '../components/settings/NotificationsTab';
import IntegrationsTab from '../components/settings/IntegrationsTab';
import TeamTab from '../components/settings/TeamTab';
import AccountActions from '../components/settings/AccountActions';
import HistoryImportPanel from '../components/settings/HistoryImportPanel';
import HelpGuide from './HelpGuide';
import StaffHelpGuide from './StaffHelpGuide';
import PageHeader from '../components/ui/PageHeader';

// Settings shell: shared page header + the active section for the signed-in
// role. Admin-only operational settings are organized into tabs, with each
// tab + the profile card extracted into their own components (components/settings/).
export default function ProfileSettingsView({
  role,
  profile,
  staffList,
  staffLoadError,
  onAddStaff,
  onRemoveStaff,
  onUpdateStaff,
  customerInfo,
  onUpdateCustomer,
  onProfileUpdated,
  onRequestLogout,
}) {
  // Active admin settings tab (General / Notifications / Integrations / …).
  // Kept in ?tab= so a reload or a shared link reopens the same tab. Other
  // query params (e.g. ?demo=) are preserved; unknown values fall back.
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const adminSection = ADMIN_SECTIONS.some((s) => s.id === requested) ? requested : 'general';
  const setAdminSection = (id) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id === 'general') next.delete('tab'); else next.set('tab', id);
      return next;
    }, { replace: true });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-5xl">
      <PageHeader title="Settings" subtitle="Manage your preferences and account." />

      {/* Profile card */}
      <ProfileHeader
        role={role}
        profile={profile}
        customerInfo={customerInfo}
        onUpdateCustomer={onUpdateCustomer}
        onProfileUpdated={onProfileUpdated}
      />

      {/* Customer-only settings */}
      {role === 'Customer' && (
        <CustomerSettings profile={profile} customerInfo={customerInfo} onUpdateCustomer={onUpdateCustomer} />
      )}

      {/* Operations Settings — Admin only, organized into tabs */}
      {role === 'Admin' && (
        <>
          <AdminSectionTabs active={adminSection} onChange={setAdminSection} />

          {adminSection === 'general' && <GeneralTab />}
          {adminSection === 'data' && <DataBackupsTab />}
          {adminSection === 'notifications' && <NotificationsTab profile={profile} />}
          {adminSection === 'integrations' && <IntegrationsTab />}
          {adminSection === 'team' && (
            <TeamTab
              staffList={staffList}
              staffLoadError={staffLoadError}
              onAddStaff={onAddStaff}
              onRemoveStaff={onRemoveStaff}
              onUpdateStaff={onUpdateStaff}
              profile={profile}
            />
          )}
          {/* Help Guide — its own Settings tab (users get the portal Help page). */}
          {adminSection === 'help' && <HelpGuide role={role} fluid />}
        </>
      )}

      {/* Staff-only Help Guide (Admin has the shared guide as a tab above) */}
      {role === 'Staff' && <StaffHelpGuide />}

      {/* Past-records import — Staff transcribe logbooks here (Admin gets the
          same panel inside the Data & Backups tab instead). Forecast-only. */}
      {role === 'Staff' && <HistoryImportPanel />}

      {/* Sign Out */}
      <AccountActions onRequestLogout={onRequestLogout} />
    </div>
  );
}