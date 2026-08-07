import { useState } from 'react';
import PromoCodesManager from '../components/PromoCodesManager';
import ProfileHeader from '../components/settings/ProfileHeader';
import CustomerSettings from '../components/settings/CustomerSettings';
import AdminSectionTabs from '../components/settings/AdminSectionTabs';
import GeneralTab from '../components/settings/GeneralTab';
import NotificationsTab from '../components/settings/NotificationsTab';
import IntegrationsTab from '../components/settings/IntegrationsTab';
import TeamTab from '../components/settings/TeamTab';
import AccountActions from '../components/settings/AccountActions';
import HelpGuide from './HelpGuide';

// Settings shell: shared page header + the active section for the signed-in
// role. Admin-only operational settings are organized into tabs, with each
// tab + the profile card extracted into their own components (components/settings/).
export default function ProfileSettingsView({
  role,
  profile,
  staffList,
  onAddStaff,
  onRemoveStaff,
  customerInfo,
  onUpdateCustomer,
  onRequestLogout,
}) {
  // Active admin settings tab (General / Notifications / Integrations / …).
  const [adminSection, setAdminSection] = useState('general');

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-5xl">
      <div>
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">Settings</h2>
        <p className="text-sm text-gray-500 font-medium mt-1">Manage your preferences and account.</p>
      </div>

      {/* Profile card */}
      <ProfileHeader role={role} profile={profile} customerInfo={customerInfo} onUpdateCustomer={onUpdateCustomer} />

      {/* Customer-only settings */}
      {role === 'Customer' && (
        <CustomerSettings profile={profile} customerInfo={customerInfo} onUpdateCustomer={onUpdateCustomer} />
      )}

      {/* Operations Settings — Admin only, organized into tabs */}
      {role === 'Admin' && (
        <>
          <AdminSectionTabs active={adminSection} onChange={setAdminSection} />

          {adminSection === 'general' && <GeneralTab />}
          {adminSection === 'notifications' && <NotificationsTab profile={profile} />}
          {adminSection === 'integrations' && <IntegrationsTab />}
          {adminSection === 'promotions' && <PromoCodesManager />}
          {adminSection === 'team' && (
            <TeamTab staffList={staffList} onAddStaff={onAddStaff} onRemoveStaff={onRemoveStaff} profile={profile} />
          )}
          {/* Help Guide — its own Settings tab (users get the portal Help page). */}
          {adminSection === 'help' && <HelpGuide role={role} />}
        </>
      )}

      {/* Sign Out */}
      <AccountActions onRequestLogout={onRequestLogout} />
    </div>
  );
}