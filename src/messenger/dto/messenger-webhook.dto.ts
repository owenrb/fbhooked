export class SenderRecipient {
  id: string;
}

export class MessageAttachmentPayload {
  url?: string;
  [key: string]: any;
}

export class MessageAttachment {
  type: string;
  payload: MessageAttachmentPayload;
}

export class QuickReply {
  payload: string;
}

export class MessageContent {
  mid: string;
  text?: string;
  quick_reply?: QuickReply;
  attachments?: MessageAttachment[];
  is_echo?: boolean;
}

export class PostbackContent {
  title: string;
  payload: string;
  referral?: any;
}

export class ReadContent {
  watermark: number;
}

export class DeliveryContent {
  mids?: string[];
  watermark: number;
}

export class MessagingEvent {
  sender: SenderRecipient;
  recipient: SenderRecipient;
  timestamp: number;
  message?: MessageContent;
  postback?: PostbackContent;
  read?: ReadContent;
  delivery?: DeliveryContent;
  [key: string]: any;
}

export class MessagingEntry {
  id: string;
  time: number;
  messaging: MessagingEvent[];
}

export class MessengerWebhookDto {
  object: string;
  entry: MessagingEntry[];
}
