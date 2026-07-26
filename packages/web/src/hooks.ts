import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
	data: T | null;
	/** 仅首次加载为 true；后台刷新时保持 false，避免页面闪成骨架屏 */
	loading: boolean;
	/** 后台刷新中（手动或轮询触发） */
	refreshing: boolean;
	error: string | null;
	/** 上次成功加载的时刻 */
	loadedAt: string | null;
	refresh: () => void;
}

/**
 * 统一的异步数据加载：首次加载态、后台刷新态、错误态、定时轮询。
 * 后台数据每小时才变一次，所以刷新失败时保留上一次的数据不清空——
 * 让页面退化成"数据略旧"而不是"整片空白"。
 */
export function useAsync<T>(
	loader: () => Promise<T>,
	deps: unknown[] = [],
	pollMs = 0,
): AsyncState<T> {
	const [data, setData] = useState<T | null>(null);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loadedAt, setLoadedAt] = useState<string | null>(null);

	// 卸载后不再 setState；同时用序号丢弃过期请求的结果
	const alive = useRef(true);
	const seq = useRef(0);
	const loaderRef = useRef(loader);
	loaderRef.current = loader;

	const run = useCallback(async (isInitial: boolean) => {
		const ticket = ++seq.current;
		if (isInitial) setLoading(true);
		else setRefreshing(true);
		try {
			const result = await loaderRef.current();
			if (!alive.current || ticket !== seq.current) return;
			setData(result);
			setError(null);
			setLoadedAt(new Date().toISOString());
		} catch (err) {
			if (!alive.current || ticket !== seq.current) return;
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			if (alive.current && ticket === seq.current) {
				setLoading(false);
				setRefreshing(false);
			}
		}
	}, []);

	useEffect(() => {
		alive.current = true;
		void run(true);
		return () => {
			alive.current = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, deps);

	useEffect(() => {
		if (pollMs <= 0) return;
		const timer = setInterval(() => {
			// 页面在后台时不轮询，省得白跑请求
			if (document.visibilityState === "visible") void run(false);
		}, pollMs);
		return () => clearInterval(timer);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pollMs, ...deps]);

	const refresh = useCallback(() => {
		void run(false);
	}, [run]);

	return { data, loading, refreshing, error, loadedAt, refresh };
}

/** 输入防抖，用于搜索框——避免每敲一个字就打一次接口 */
export function useDebounced<T>(value: T, delayMs = 300): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(timer);
	}, [value, delayMs]);
	return debounced;
}
