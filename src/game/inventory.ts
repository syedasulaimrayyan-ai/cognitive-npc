export interface Item {
  id: string;
  name: string;
  description: string;
  price: number;
  icon?: string;
}

export interface Inventory {
  coins: number;
  items: Map<string, number>; // itemId -> quantity
}

export const ITEMS: Record<string, Item> = {
  supplies: { id: 'supplies', name: 'Supply Package', description: 'The requested supplies', price: 10 },
  food: { id: 'food', name: 'Fresh Food', description: 'Tasty provisions', price: 5 },
  tools: { id: 'tools', name: 'Iron Tools', description: 'Quality tools', price: 15 },
  herbs: { id: 'herbs', name: 'Herbs', description: 'Medicinal herbs', price: 3 },
};

export const SHOP_INVENTORY: Record<string, string[]> = {
  maya: ['supplies', 'herbs'],
  amira: ['food', 'herbs'],
  tariq: ['tools'],
  arjun: ['supplies', 'tools'],
};

export class PlayerInventory {
  state: Inventory = {
    coins: 25,
    items: new Map(),
  };

  hasCoins(amount: number): boolean {
    return this.state.coins >= amount;
  }

  buy(itemId: string): boolean {
    const item = ITEMS[itemId];
    if (!item) return false;
    if (!this.hasCoins(item.price)) return false;
    this.state.coins -= item.price;
    this.state.items.set(itemId, (this.state.items.get(itemId) || 0) + 1);
    return true;
  }

  hasItem(itemId: string): boolean {
    return (this.state.items.get(itemId) || 0) > 0;
  }
}
