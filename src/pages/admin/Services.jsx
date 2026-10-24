import React, { useState, useEffect, useCallback } from 'react';
import { Scissors, Sparkles, Briefcase, Plus } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import AdminPage from '@/components/admin/ui/AdminPage';
import ServiceCard from '@/components/services/ServiceCard';
import AddOnCard from '@/components/services/AddOnCard';
import ProductCard from '@/components/services/ProductCard';
import ItemEditor from '@/components/services/ItemEditor';
import ServiceEditorModal from '@/components/services/ServiceEditorModal';

const TABS = [
  { key: 'services', label: 'Services', icon: Scissors },
  { key: 'addons', label: 'Add-ons', icon: Sparkles },
  { key: 'products', label: 'Products', icon: Briefcase },
];

const DEFAULT_SERVICES = [
  { name: 'Haircut', price: 65, duration_mins: 30, sort_order: 1, is_active: true },
  { name: 'High School', price: 55, duration_mins: 30, sort_order: 2, is_active: true },
  { name: 'Kids Cut', price: 50, duration_mins: 30, sort_order: 3, is_active: true },
  { name: 'Haircut + Beard', price: 75, duration_mins: 45, sort_order: 4, is_active: true },
  { name: 'Beard Trim', price: 35, duration_mins: 20, sort_order: 5, is_active: true },
];

const DEFAULT_ADDONS = [
  { name: 'Eyebrows', price_adjustment: 10, duration_adjustment: 5, sort_order: 1, is_active: true },
  { name: 'Waxing', price_adjustment: 10, duration_adjustment: 5, sort_order: 2, is_active: true },
  { name: 'Hair Design', price_adjustment: 15, duration_adjustment: 10, variable_price: true, min_price: 15, max_duration: 20, sort_order: 3, is_active: true },
  { name: 'Beard Line-up', price_adjustment: 15, duration_adjustment: 10, sort_order: 4, is_active: true },
  { name: 'Hot Towel', price_adjustment: 8, duration_adjustment: 5, sort_order: 5, is_active: true },
];

const DEFAULT_PRODUCTS = [
  { name: 'Texture Powder', selling_price: 25, stock_quantity: 12, low_stock_threshold: 5, is_active: true },
  { name: 'Sea Salt Spray', selling_price: 28, stock_quantity: 8, low_stock_threshold: 5, is_active: true },
  { name: 'Beard Oil', selling_price: 22, stock_quantity: 3, low_stock_threshold: 5, is_active: true },
  { name: 'Styling Cream', selling_price: 24, stock_quantity: 15, low_stock_threshold: 5, is_active: true },
];

export default function Services() {
  const [tab, setTab] = useState(() => sessionStorage.getItem('cd_services_tab') || 'services');
  const [services, setServices] = useState([]);
  const [addons, setAddons] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null);

  useEffect(() => { sessionStorage.setItem('cd_services_tab', tab); }, [tab]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, a, p] = await Promise.all([
        base44.entities.Service.list('sort_order', 100),
        base44.entities.AddOn.list('sort_order', 100),
        base44.entities.Product.list('-created_date', 100),
      ]);
      if (s.length === 0) {
        const seeded = await base44.entities.Service.bulkCreate(DEFAULT_SERVICES);
        setServices(seeded);
      } else setServices(s);
      if (a.length === 0) {
        const seeded = await base44.entities.AddOn.bulkCreate(DEFAULT_ADDONS);
        setAddons(seeded);
      } else setAddons(a);
      if (p.length === 0) {
        const seeded = await base44.entities.Product.bulkCreate(DEFAULT_PRODUCTS);
        setProducts(seeded);
      } else setProducts(p);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const nameById = (list, ids) => (ids || []).map(id => list.find(x => x.id === id)?.name).filter(Boolean);

  const saveItem = async (payload) => {
    if (editor.type === 'service') {
      if (editor.item) await base44.entities.Service.update(editor.item.id, payload);
      else await base44.entities.Service.create({ ...payload, sort_order: services.length + 1 });
    } else if (editor.type === 'addon') {
      if (editor.item) await base44.entities.AddOn.update(editor.item.id, payload);
      else await base44.entities.AddOn.create({ ...payload, sort_order: addons.length + 1 });
    } else {
      if (editor.item) await base44.entities.Product.update(editor.item.id, payload);
      else await base44.entities.Product.create(payload);
    }
    setEditor(null);
    loadAll();
  };

  const duplicate = async (type, item) => {
    const { id, created_date, updated_date, created_by_id, ...rest } = item;
    rest.name = `${item.name} (copy)`;
    if (type === 'service') await base44.entities.Service.create(rest);
    else if (type === 'addon') await base44.entities.AddOn.create(rest);
    else await base44.entities.Product.create(rest);
    loadAll();
  };

  const reorder = async (type, list, item, dir) => {
    const idx = list.findIndex(x => x.id === item.id);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= list.length) return;
    const other = list[swapIdx];
    const entity = type === 'service' ? base44.entities.Service : type === 'addon' ? base44.entities.AddOn : base44.entities.Product;
    await Promise.all([
      entity.update(item.id, { sort_order: other.sort_order }),
      entity.update(other.id, { sort_order: item.sort_order }),
    ]);
    loadAll();
  };

  const toggleActive = async (type, item) => {
    const entity = type === 'service' ? base44.entities.Service : type === 'addon' ? base44.entities.AddOn : base44.entities.Product;
    await entity.update(item.id, { is_active: !item.is_active });
    loadAll();
  };

  const remove = async (type, item) => {
    const entity = type === 'service' ? base44.entities.Service : type === 'addon' ? base44.entities.AddOn : base44.entities.Product;
    await entity.delete(item.id);
    loadAll();
  };

  const deleteService = async (item) => {
    await base44.entities.Service.delete(item.id);
    setEditor(null);
    loadAll();
  };

  const menuFor = (type, item, list) => [
    { label: `Edit ${type === 'service' ? 'Service' : type === 'addon' ? 'Add-on' : 'Product'}`, onClick: () => setEditor({ type, item }) },
    { divider: true },
    { label: 'Duplicate', onClick: () => duplicate(type, item) },
    { label: 'Move up', onClick: () => reorder(type, list, item, 'up') },
    { label: 'Move down', onClick: () => reorder(type, list, item, 'down') },
    { divider: true },
    { label: item.is_active === false ? 'Activate' : 'Deactivate', onClick: () => toggleActive(type, item) },
    { label: 'Delete', danger: true, onClick: () => remove(type, item) },
  ];

  const addButtonLabel = tab === 'services' ? 'Add Service' : tab === 'addons' ? 'Add Add-on' : 'Add Product';
  const editorType = tab === 'services' ? 'service' : tab === 'addons' ? 'addon' : 'product';

  return (
    <AdminPage
      title="Services"
      subtitle="Manage your services, add-ons, and products"
      actions={
        <Button onClick={() => setEditor({ type: editorType, item: null })} className="min-h-[44px]">
          <Plus className="w-4 h-4" /> {addButtonLabel}
        </Button>
      }
    >
      <div className="border-b border-zinc-200">
        <div className="flex gap-1">
          {TABS.map(t => {
            const active = tab === t.key;
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${active ? 'border-violet-600 text-violet-700' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}>
                <t.icon className="w-4 h-4" /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-3">
          {tab === 'services' && services.map(s => (
            <ServiceCard key={s.id} service={s} addonNames={nameById(addons, s.available_addons)} onMenu={menuFor('service', s, services)} />
          ))}
          {tab === 'addons' && addons.map(a => (
            <AddOnCard key={a.id} addon={a} serviceNames={nameById(services, a.compatible_services)} onMenu={menuFor('addon', a, addons)} />
          ))}
          {tab === 'products' && products.map(p => (
            <ProductCard key={p.id} product={p} serviceNames={nameById(services, p.suggested_services)} onMenu={menuFor('product', p, products)} />
          ))}
          {tab === 'services' && services.length === 0 && <Empty label="services" />}
          {tab === 'addons' && addons.length === 0 && <Empty label="add-ons" />}
          {tab === 'products' && products.length === 0 && <Empty label="products" />}
        </div>
      )}

      {editor && editor.type === 'service' && (
        <ServiceEditorModal
          item={editor.item}
          addons={addons}
          onClose={() => setEditor(null)}
          onSave={saveItem}
          onDelete={deleteService}
        />
      )}
      {editor && editor.type !== 'service' && (
        <ItemEditor
          type={editor.type}
          item={editor.item}
          services={services}
          addons={addons}
          products={products}
          onClose={() => setEditor(null)}
          onSave={saveItem}
        />
      )}
    </AdminPage>
  );
}

function Empty({ label }) {
  return (
    <div className="text-center py-16 border border-dashed border-zinc-200 rounded-xl">
      <p className="text-sm text-zinc-400">No {label} yet. Click "Add" to create your first one.</p>
    </div>
  );
}