export interface RequiredChannel {
  id: number;
  chatRef: string;
  chatId: number | null;
  title: string;
  joinUrl: string | null;
  isEnabled: boolean;
  createdAt: number;
}

export interface NewRequiredChannel {
  chatRef: string;
  chatId: number | null;
  title: string;
  joinUrl: string | null;
  isEnabled?: boolean;
}

export interface ChannelDraft {
  chatRef: string;
  chatId: number | null;
  title: string;
  joinUrl: string | null;
}
