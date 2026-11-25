import React, { useState, useMemo } from 'react';
import { CustomerDoc, Language } from '../types';
import { saveDocument, deleteDocument } from '../data/db';
import { extractHouseNumber, searchCustomers } from '../engine/customers';
import {
  X,
  Search,
  UserPlus,
  Users,
  Phone,
  MapPin,
  Home,
  Edit2,
  Trash2,
  Check,
  AlertCircle,
  FileText,
} from 'lucide-react';

interface Props {
  customers: CustomerDoc[];
  lang: Language;
  onClose: () => void;
  /** When provided, allows selecting/attaching a customer directly to the active POS bill */
  onSelectCustomer?: (customer: CustomerDoc) => void;
  /** Optional initial search text or draft to prefill add form */
  initialQuery?: string;
  initialOpenForm?: boolean;
  initialEditCustomer?: CustomerDoc | null;
}

export const CustomerManagerModal: React.FC<Props> = ({
  customers,
  lang,
  onClose,
  onSelectCustomer,
  initialQuery = '',
  initialOpenForm = false,
  initialEditCustomer = null,
}) => {
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [isFormOpen, setIsFormOpen] = useState(Boolean(initialOpenForm || initialEditCustomer));
  const [editingCustomer, setEditingCustomer] = useState<CustomerDoc | null>(initialEditCustomer);

  const guessInitialPhoneOrHouse = (q: string) => {
    const trimmed = q.trim();
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length >= 6 && !trimmed.includes('/')) {
      return { phone: trimmed, houseNumber: '' };
    }
    return { phone: '', houseNumber: trimmed };
  };

  const guessed = guessInitialPhoneOrHouse(initialQuery);

  const [name, setName] = useState(initialEditCustomer?.name || '');
  const [phone, setPhone] = useState(initialEditCustomer?.phone || guessed.phone);
  const [houseNumber, setHouseNumber] = useState(initialEditCustomer?.houseNumber || guessed.houseNumber);
  const [address, setAddress] = useState(initialEditCustomer?.address || '');
  const [notes, setNotes] = useState(initialEditCustomer?.notes || '');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const filteredCustomers = useMemo(
    () => searchCustomers(customers, searchQuery),
    [customers, searchQuery]
  );

  const openNewForm = (prefill?: string) => {
    const g = guessInitialPhoneOrHouse(prefill || '');
    setEditingCustomer(null);
    setName('');
    setPhone(g.phone);
    setHouseNumber(g.houseNumber);
    setAddress(g.houseNumber ? `${g.houseNumber} ` : '');
    setNotes('');
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEditForm = (cust: CustomerDoc) => {
    setEditingCustomer(cust);
    setName(cust.name || '');
    setPhone(cust.phone || '');
    setHouseNumber(cust.houseNumber || extractHouseNumber(cust.address));
    setAddress(cust.address || '');
    setNotes(cust.notes || '');
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    const trimmedAddress = address.trim();
    const trimmedHouseNo = houseNumber.trim() || extractHouseNumber(trimmedAddress);

    if (!trimmedName) {
      setFormError(lang === 'th' ? 'กรุณากรอกชื่อลูกค้า' : 'Please enter customer name');
      return;
    }
    if (!trimmedPhone && !trimmedAddress) {
      setFormError(
        lang === 'th'
          ? 'กรุณากรอกเบอร์โทรหรือที่อยู่จัดส่งอย่างน้อย 1 อย่าง'
          : 'Please enter phone number or delivery address'
      );
      return;
    }

    setFormError(null);
    setIsSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const isNew = !editingCustomer;
      const docToSave: CustomerDoc = {
        id: editingCustomer?.id || `cust_${Date.now()}`,
        name: trimmedName,
        phone: trimmedPhone,
        address: trimmedAddress,
        ...(trimmedHouseNo ? { houseNumber: trimmedHouseNo } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        createdAt: editingCustomer?.createdAt || nowIso,
        updatedAt: nowIso,
        version: editingCustomer?.version || 1,
      };
      await saveDocument('customers', docToSave, isNew);
      setIsFormOpen(false);
      setEditingCustomer(null);
      if (onSelectCustomer) {
        onSelectCustomer({
          ...docToSave,
          version: isNew ? 1 : (editingCustomer?.version || 1) + 1,
        });
        onClose();
      }
    } catch (err) {
      console.error('Save customer error:', err);
      setFormError(
        lang === 'th'
          ? 'บันทึกข้อมูลลูกค้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
          : 'Failed to save customer. Please try again.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setIsDeleting(true);
    try {
      await deleteDocument('customers', id);
      setPendingDeleteId(null);
    } catch (err) {
      console.error('Delete customer error:', err);
      setFormError(lang === 'th' ? 'ลบข้อมูลลูกค้าไม่สำเร็จ' : 'Failed to delete customer');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
      <div className="modal-panel bg-white rounded-3xl shadow-2xl max-w-2xl w-full border border-orange-200">
        {/* Header */}
        <div className="modal-header bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-amber-200" />
            <div>
              <h3 className="font-extrabold text-base">
                {isFormOpen
                  ? editingCustomer
                    ? lang === 'th'
                      ? 'แก้ไขข้อมูลลูกค้า'
                      : 'Edit Customer'
                    : lang === 'th'
                    ? 'เพิ่มลูกค้าใหม่'
                    : 'Add New Customer'
                  : lang === 'th'
                  ? 'ฐานข้อมูลลูกค้า (Delivery)'
                  : 'Customer Directory (Delivery)'}
              </h3>
              <p className="text-[11px] text-orange-100">
                {lang === 'th'
                  ? `ทั้งหมด ${customers.length} ราย • ค้นหาจากบ้านเลขที่หรือเบอร์โทรได้ทันที`
                  : `${customers.length} saved • Search by house number or phone`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isFormOpen ? (
          <form onSubmit={handleSave} className="flex flex-col flex-1 min-h-0">
            <div className="modal-body space-y-3">
              {formError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-bold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {lang === 'th' ? 'ชื่อลูกค้า *' : 'Customer Name *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={lang === 'th' ? 'เช่น คุณสมชาย ใจดี' : 'e.g. Somchai'}
                    className="w-full px-3 py-2 text-xs bg-white border border-neutral-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {lang === 'th' ? 'เบอร์โทรศัพท์ *' : 'Phone Number *'}
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder={lang === 'th' ? 'เช่น 081-234-5678' : 'e.g. 081-234-5678'}
                    className="w-full px-3 py-2 text-xs bg-white border border-neutral-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {lang === 'th'
                    ? 'บ้านเลขที่ (สำหรับค้นหาเร็ว เช่น 123/45)'
                    : 'House Number (for quick lookup, e.g. 123/45)'}
                </label>
                <input
                  type="text"
                  value={houseNumber}
                  onChange={(e) => setHouseNumber(e.target.value)}
                  placeholder={lang === 'th' ? 'ระบบดึงอัตโนมัติจากที่อยู่หากเว้นว่าง' : 'Auto-detected from address if blank'}
                  className="w-full px-3 py-2 text-xs bg-white border border-neutral-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {lang === 'th' ? 'ที่อยู่สำหรับจัดส่ง *' : 'Delivery Address *'}
                </label>
                <textarea
                  rows={3}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder={
                    lang === 'th'
                      ? 'เช่น 123/45 หมู่บ้านสุขใจ ซอย 3 ถ.สุขุมวิท...'
                      : 'House No., Street, Soi, Sub-district...'
                  }
                  className="w-full px-3 py-2 text-xs bg-white border border-neutral-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:outline-hidden resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {lang === 'th' ? 'หมายเหตุ / จุดสังเกต (ไม่บังคับ)' : 'Landmark / Delivery Notes (Optional)'}
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={lang === 'th' ? 'เช่น ประตูรั้วสีฟ้า โทรก่อนถึงหน้าบ้าน' : 'e.g. Blue gate, call on arrival'}
                  className="w-full px-3 py-2 text-xs bg-white border border-neutral-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:outline-hidden"
                />
              </div>
            </div>

            <div className="modal-footer bg-neutral-50 border-t border-neutral-200 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsFormOpen(false);
                  setEditingCustomer(null);
                  setFormError(null);
                }}
                className="px-4 py-2 bg-white hover:bg-neutral-100 text-neutral-700 border border-neutral-300 rounded-xl text-xs font-bold cursor-pointer"
              >
                {lang === 'th' ? 'กลับไปรายการ' : 'Back to List'}
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-5 py-2.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-md shadow-orange-500/20 cursor-pointer disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                <span>
                  {isSaving
                    ? lang === 'th'
                      ? 'กำลังบันทึก...'
                      : 'Saving...'
                    : onSelectCustomer
                    ? lang === 'th'
                      ? 'บันทึกและใช้กับบิลนี้'
                      : 'Save & Attach to Bill'
                    : lang === 'th'
                    ? 'บันทึกข้อมูลลูกค้า'
                    : 'Save Customer'}
                </span>
              </button>
            </div>
          </form>
        ) : (
          <>
            {/* Search & Add Bar */}
            <div className="p-3 bg-neutral-50 border-b border-neutral-200 flex flex-col sm:flex-row gap-2 shrink-0">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    lang === 'th'
                      ? 'ค้นหาบ้านเลขที่, เบอร์โทร, หรือชื่อลูกค้า...'
                      : 'Search by house no., phone, or name...'
                  }
                  className="w-full pl-9 pr-8 py-2 text-xs bg-white border border-neutral-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:outline-hidden"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => openNewForm(searchQuery)}
                className="px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black flex items-center justify-center gap-1.5 shadow-sm cursor-pointer shrink-0 hover:brightness-105"
              >
                <UserPlus className="w-4 h-4" />
                <span>{lang === 'th' ? 'เพิ่มลูกค้าใหม่' : 'Add Customer'}</span>
              </button>
            </div>

            {/* Customer List */}
            <div className="modal-body space-y-2 bg-neutral-50/40">
              {filteredCustomers.length === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <Users className="w-10 h-10 text-neutral-300 mx-auto" />
                  <p className="text-xs font-bold text-neutral-600">
                    {searchQuery
                      ? lang === 'th'
                        ? `ไม่พบข้อมูลลูกค้าที่ตรงกับ "${searchQuery}"`
                        : `No customers matching "${searchQuery}"`
                      : lang === 'th'
                      ? 'ยังไม่มีข้อมูลลูกค้าในระบบ'
                      : 'No saved customers yet'}
                  </p>
                  <button
                    type="button"
                    onClick={() => openNewForm(searchQuery)}
                    className="px-4 py-2 bg-orange-100 hover:bg-orange-200 text-orange-800 border border-orange-300 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>{lang === 'th' ? 'บันทึกลูกค้าใหม่เลย' : 'Create First Customer'}</span>
                  </button>
                </div>
              ) : (
                filteredCustomers.map((cust) => {
                  const displayHouseNo = cust.houseNumber || extractHouseNumber(cust.address);
                  const isConfirmingDelete = pendingDeleteId === cust.id;

                  return (
                    <div
                      key={cust.id}
                      className="p-3 bg-white rounded-2xl border border-neutral-200 hover:border-orange-300 shadow-2xs transition-colors space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-extrabold text-sm text-neutral-900">
                              {cust.name}
                            </span>
                            {displayHouseNo && (
                              <span className="px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-black inline-flex items-center gap-1">
                                <Home className="w-3 h-3" />
                                {displayHouseNo}
                              </span>
                            )}
                            {cust.phone && (
                              <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-bold inline-flex items-center gap-1 tabular-nums">
                                <Phone className="w-3 h-3 text-orange-600" />
                                {cust.phone}
                              </span>
                            )}
                          </div>

                          {cust.address && (
                            <div className="text-xs text-neutral-600 flex items-start gap-1.5">
                              <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                              <span className="whitespace-pre-wrap break-words">{cust.address}</span>
                            </div>
                          )}

                          {cust.notes && (
                            <div className="text-[11px] text-amber-700 flex items-start gap-1.5">
                              <FileText className="w-3 h-3 shrink-0 mt-0.5" />
                              <span>{cust.notes}</span>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {onSelectCustomer && (
                            <button
                              type="button"
                              onClick={() => {
                                onSelectCustomer(cust);
                                onClose();
                              }}
                              className="px-3 py-1.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black flex items-center gap-1 shadow-xs cursor-pointer hover:brightness-105"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>{lang === 'th' ? 'เลือก' : 'Select'}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openEditForm(cust)}
                            className="p-1.5 text-neutral-500 hover:text-orange-600 hover:bg-orange-50 rounded-lg cursor-pointer"
                            title={lang === 'th' ? 'แก้ไข' : 'Edit'}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setPendingDeleteId(isConfirmingDelete ? null : cust.id)
                            }
                            className="p-1.5 text-neutral-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                            title={lang === 'th' ? 'ลบ' : 'Delete'}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {isConfirmingDelete && (
                        <div className="pt-2 border-t border-rose-100 flex items-center justify-between gap-2 text-xs">
                          <span className="text-rose-700 font-bold">
                            {lang === 'th'
                              ? `ยืนยันลบข้อมูล "${cust.name}"?`
                              : `Delete "${cust.name}"?`}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setPendingDeleteId(null)}
                              className="px-2.5 py-1 rounded-lg bg-neutral-100 text-neutral-700 font-bold cursor-pointer"
                            >
                              {lang === 'th' ? 'ยกเลิก' : 'Cancel'}
                            </button>
                            <button
                              type="button"
                              disabled={isDeleting}
                              onClick={() => handleDelete(cust.id)}
                              className="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-bold cursor-pointer disabled:opacity-50"
                            >
                              {lang === 'th' ? 'ลบเลย' : 'Delete'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="modal-footer bg-white border-t border-neutral-200 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-neutral-200 hover:bg-neutral-300 text-neutral-800 rounded-xl text-xs font-bold cursor-pointer"
              >
                {lang === 'th' ? 'ปิด' : 'Close'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
