export const WABA_FLOW_TRIGGERS = [
    { id: 'ACCOUNT_CREATED', label: 'Account Created', description: 'When a new user registers' },
    { id: 'ORDER_PLACED', label: 'Order Placed', description: 'When a user completes checkout' },
    { id: 'ORDER_SHIPPED', label: 'Order Shipped', description: 'When a Delhivery AWB is saved' },
    { id: 'ORDER_DELIVERED', label: 'Order Delivered', description: 'When the shipment is marked delivered' },
    { id: 'ABANDONED_CART', label: 'Abandoned Cart', description: 'When a user leaves items in cart' },
    { id: 'REORDER_FOLLOWUP', label: 'Re-order Follow up', description: 'Send sequence after purchase' },
    { id: 'COD_PAYMENT_FOLLOWUP', label: 'COD payment follow-up', description: 'Remind unpaid admin/COD orders until payment is marked received' },
    { id: 'QUOTATION_FOLLOWUP', label: 'Quotation follow-up', description: 'Send the estimate, then remind until the clinic pays or the quote expires' },
    { id: 'MANUAL_SALE_CUSTOMER', label: 'Manual sale — customer', description: 'Order confirmation sent to the clinic after a salesperson creates a paid order' },
    { id: 'WARRANTY_REGISTER', label: 'Warranty registration', description: 'Sent after a machine order so the clinic registers the serial' },
    { id: 'WARRANTY_ACTIVATED', label: 'Warranty activated', description: 'Sent when a serial is registered on the public form or in admin' },
] as const
